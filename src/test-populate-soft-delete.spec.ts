import { suite, test } from '@testdeck/mocha';
import { assert } from 'chai';
import * as Mongoose from 'mongoose';

import { MongooseQueryParser } from './';


@suite('test-populate-soft-delete.spec')
class PopulateSoftDeleteTester {

  static CONN_STR = 'mongodb://localhost:27017/test';
  static conn: Mongoose.Connection;
  static User: Mongoose.Model<any, any>;
  static Community: Mongoose.Model<any, any>;

  static connect() {
    if (PopulateSoftDeleteTester.conn == null) {
      PopulateSoftDeleteTester.conn = Mongoose.createConnection(PopulateSoftDeleteTester.CONN_STR);
    }
  }

  static async before() {
    const userSchema = new Mongoose.Schema({
      name: String,
      email: String,
      _deleted: { type: Date, default: null }
    });

    const communitySchema = new Mongoose.Schema({
      name: String,
      manager: { type: Mongoose.Schema.Types.ObjectId, ref: 'SoftUser' },
      residents: [{ type: Mongoose.Schema.Types.ObjectId, ref: 'SoftUser' }]
    });

    PopulateSoftDeleteTester.connect();
    PopulateSoftDeleteTester.User = PopulateSoftDeleteTester.conn.model('SoftUser', userSchema);
    PopulateSoftDeleteTester.Community = PopulateSoftDeleteTester.conn.model('SoftCommunity', communitySchema);

    // Create users - some active, some soft-deleted
    const alice = new PopulateSoftDeleteTester.User({ name: 'Alice', email: 'alice@mail.com', _deleted: null });
    await alice.save();
    const bob = new PopulateSoftDeleteTester.User({ name: 'Bob', email: 'bob@mail.com', _deleted: new Date('2025-01-15') });
    await bob.save();
    const carol = new PopulateSoftDeleteTester.User({ name: 'Carol', email: 'carol@mail.com', _deleted: null });
    await carol.save();
    const dave = new PopulateSoftDeleteTester.User({ name: 'Dave', email: 'dave@mail.com', _deleted: new Date('2025-02-01') });
    await dave.save();

    // Community with soft-deleted manager (single ref)
    const sunrise = new PopulateSoftDeleteTester.Community({
      name: 'Sunrise',
      manager: bob._id,
      residents: [alice._id, bob._id, carol._id, dave._id]
    });
    await sunrise.save();

    // Community with active manager
    const sunset = new PopulateSoftDeleteTester.Community({
      name: 'Sunset',
      manager: alice._id,
      residents: [alice._id, carol._id]
    });
    await sunset.save();
  }

  static async after() {
    await PopulateSoftDeleteTester.User.collection.drop();
    await PopulateSoftDeleteTester.Community.collection.drop();
    await PopulateSoftDeleteTester.conn?.close();
  }

  @test('populate should include match: { _deleted: null } on every path')
  async testMatchFilterPresent() {
    const parser = new MongooseQueryParser();
    const parsed = parser.parse('populate=manager,residents');
    const populate: any[] = parsed.populate;

    assert.exists(populate);
    assert.equal(populate.length, 2);
    for (const p of populate) {
      assert.deepEqual(p.match, { _deleted: null }, `${p.path} should have _deleted match filter`);
    }
  }

  @test('populate with field selection should still include match filter')
  async testMatchFilterWithSelect() {
    const parser = new MongooseQueryParser();
    const parsed = parser.parse('populate=manager.name,manager.email,residents');
    const populate: any[] = parsed.populate;

    assert.exists(populate);
    for (const p of populate) {
      assert.deepEqual(p.match, { _deleted: null });
    }
    const managerPopulate = populate.find(p => p.path === 'manager');
    assert.equal(managerPopulate.select, 'name email');
  }

  @test('array ref should exclude soft-deleted items')
  async testArrayRefFiltersSoftDeleted() {
    const parser = new MongooseQueryParser();
    const parsed = parser.parse('name=Sunrise&populate=residents');
    const populate: any[] = parsed.populate;

    const records = await PopulateSoftDeleteTester.Community
      .find(parsed.filter)
      .populate(populate)
      .lean();

    assert.equal(records.length, 1);
    const community = records[0];

    // Sunrise has 4 residents but 2 are soft-deleted
    assert.equal(community.residents.length, 2);
    const names = community.residents.map((r: any) => r.name).sort();
    assert.deepEqual(names, ['Alice', 'Carol']);
  }

  @test('single ref should be null when populated doc is soft-deleted')
  async testSingleRefNullWhenDeleted() {
    const parser = new MongooseQueryParser();
    const parsed = parser.parse('name=Sunrise&populate=manager.name,manager.email');
    const populate: any[] = parsed.populate;

    const records = await PopulateSoftDeleteTester.Community
      .find(parsed.filter)
      .populate(populate)
      .lean();

    assert.equal(records.length, 1);
    const community = records[0];

    // Bob is soft-deleted, so manager should be null
    assert.isNull(community.manager);
  }

  @test('single ref should populate when doc is not soft-deleted')
  async testSingleRefPopulatesWhenActive() {
    const parser = new MongooseQueryParser();
    const parsed = parser.parse('name=Sunset&populate=manager.name,manager.email');
    const populate: any[] = parsed.populate;

    const records = await PopulateSoftDeleteTester.Community
      .find(parsed.filter)
      .populate(populate)
      .lean();

    assert.equal(records.length, 1);
    const community = records[0];

    // Alice is active, so manager should be populated
    assert.exists(community.manager);
    assert.equal(community.manager.name, 'Alice');
    assert.equal(community.manager.email, 'alice@mail.com');
  }

  @test('array ref with all active members should return all')
  async testArrayRefAllActive() {
    const parser = new MongooseQueryParser();
    const parsed = parser.parse('name=Sunset&populate=residents');
    const populate: any[] = parsed.populate;

    const records = await PopulateSoftDeleteTester.Community
      .find(parsed.filter)
      .populate(populate)
      .lean();

    assert.equal(records.length, 1);
    const community = records[0];

    // Sunset only has active residents
    assert.equal(community.residents.length, 2);
    const names = community.residents.map((r: any) => r.name).sort();
    assert.deepEqual(names, ['Alice', 'Carol']);
  }

  @test('nested populate should include match filter at all levels')
  async testNestedPopulateMatchFilter() {
    const parser = new MongooseQueryParser();
    const parsed = parser.parse('populate=manager:friends.name,manager.name');
    const populate: any[] = parsed.populate;

    assert.equal(populate.length, 1);
    const managerPop = populate[0];

    // Root level
    assert.deepEqual(managerPop.match, { _deleted: null });

    // Nested level
    assert.exists(managerPop.populate);
    assert.deepEqual(managerPop.populate.match, { _deleted: null });
  }
}