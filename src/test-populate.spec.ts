import { suite, test } from '@testdeck/mocha';
import { assert } from 'chai';
import * as Mongoose from 'mongoose';

import { MongooseQueryParser } from './';


@suite('test-populate.spec')
class PopulateTester {

  static CONN_STR = 'mongodb://localhost:27017/test';
  static conn: Mongoose.Connection;
  static User: Mongoose.Model<any, any>;
  static Post: Mongoose.Model<any, any>;
  static Attachment: Mongoose.Model<any, any>;
  static Video: Mongoose.Model<any, any>;
  static Link: Mongoose.Model<any, any>;
  static Forum: Mongoose.Model<any, any>;

  static connect() {
    if (PopulateTester.conn == null) {
      PopulateTester.conn = Mongoose.createConnection(PopulateTester.CONN_STR);
    }
  }

  static async before() {
    // set schemas of test db
    const userSchema = new Mongoose.Schema({
      name: String,
      email: String,
      friends: [{ type: Mongoose.Schema.Types.ObjectId, ref: 'User' }]
    });
    const postSchema = new Mongoose.Schema({
      title: String,
      contents: String,
      createdBy: { type: Mongoose.Schema.Types.ObjectId, ref: 'User' },
      likedBy: [{ type: Mongoose.Schema.Types.ObjectId, ref: 'User' }],
	  attachments: [{ type: Mongoose.Schema.Types.ObjectId, ref: 'Attachment' }]
    });

	const attachmentSchema = new Mongoose.Schema({
		video: { type: Mongoose.Schema.Types.ObjectId, ref: 'Video' },
		link: { type: Mongoose.Schema.Types.ObjectId, ref: 'Link' }
	});

	const videoSchema = new Mongoose.Schema({
		title: String,
		url: String,
		provider: String
	});

	const linkSchema = new Mongoose.Schema({
		title: String,
		url: String
	});

	const forumSchema = new Mongoose.Schema({
		name: String,
		posts: [{ type: Mongoose.Schema.Types.ObjectId, ref: 'Post' }]
	});

    PopulateTester.connect();
    PopulateTester.User = PopulateTester.conn.model('User', userSchema);
    PopulateTester.Post = PopulateTester.conn.model('Post', postSchema);
	PopulateTester.Attachment = PopulateTester.conn.model('Attachment', attachmentSchema);
	PopulateTester.Video = PopulateTester.conn.model('Video', videoSchema);
	PopulateTester.Link = PopulateTester.conn.model('Link', linkSchema);
	PopulateTester.Forum = PopulateTester.conn.model('Forum', forumSchema);

    // populate some testing data
    const jim = new PopulateTester.User({ name: 'Jim', email: 'jim@mail.com' });
    await jim.save();
    const john = new PopulateTester.User({ name: 'John', email: 'john@mail.com' });
    await john.save();
    const kate = new PopulateTester.User({ name: 'Kate', email: 'kate@mail.com' });
    await kate.save();
    // add friends
    await PopulateTester.User.findOneAndUpdate({ name: 'Jim' }, { friends: [john._id] });
    await PopulateTester.User.findOneAndUpdate({ name: 'John' }, { friends: [kate._id] });
    await PopulateTester.User.findOneAndUpdate({ name: 'Kate' }, { friends: [john._id] });


	const video = new PopulateTester.Video({ title: 'Video', link: 'https://youtu.be/dQw4w9WgXcQ', provider: 'YouTube' });
    await video.save();

	const link = new PopulateTester.Link({ title: 'Link', link: 'https://youtu.be/dQw4w9WgXcQ' });
    await link.save();

	const attachment = new PopulateTester.Attachment({ link, video });
    await attachment.save();

    // add posts
    const post1 = new PopulateTester.Post({
      title: 'Post 1',
      contents: 'Contents of Post 1',
      createdBy: john._id,
      likedBy: [kate._id, jim._id],
	  attachments: [ attachment._id ]
    });
    await post1.save();
    const post2 = new PopulateTester.Post({
      title: 'Post 2',
      contents: 'Contents of Post 2',
      createdBy: kate._id,
      likedBy: [jim._id],
	  attachments: [ attachment._id ]

    });
    await post2.save();

	const forum = new PopulateTester.Forum({
		name: 'General',
		posts: [ post1._id, post2._id ]
	});
	await forum.save();
  }

  static async after() {
    await PopulateTester.Post.collection.drop();
    await PopulateTester.User.collection.drop();
	await PopulateTester.Attachment.collection.drop();
	await PopulateTester.Link.collection.drop();
	await PopulateTester.Video.collection.drop();
	await PopulateTester.Forum.collection.drop();
    await PopulateTester.conn?.close();
  }

  @test('should query with deep populate')
  async testDeepPopulate() {
    const parser = new MongooseQueryParser();
    const qry = 'title&populate=createdBy:friends.name,createdBy:friends.email,createdBy.name,createdBy.email,likedBy.name,attachments:link,attachments:video';
    const parsed = parser.parse(qry);
    assert.exists(parsed.filter);

    let populate: any[] = parsed.populate;
    assert.exists(populate);
    assert.isTrue(populate.length == 3);
    const records = await PopulateTester.Post.find(parsed.filter).populate(populate).lean();
    for (const post of records) {
      assert.exists(post.createdBy.name);
      assert.exists(post.createdBy.friends.find((f) => f.name && f.email));
      assert.exists(post.likedBy);
	  assert.exists(post.attachments[0].video.title);
	  assert.exists(post.attachments[0].link.title)
    }
  }

  @test('should query with very deep populate')
  async testVeryDeepPopulate() {
    const parser = new MongooseQueryParser();
    const qry = 'populate=posts:attachments:link,posts:attachments:video';
    const parsed = parser.parse(qry);
    assert.exists(parsed.filter);

    let populate: any[] = parsed.populate;
    assert.exists(populate);
    assert.isTrue(populate.length == 1);
    const records = await PopulateTester.Forum.find(parsed.filter).populate(populate).lean();
    for (const forum of records) {
	  assert.exists(forum.posts[0].attachments[0].video.title);
	  assert.exists(forum.posts[0].attachments[0].link.title)
	  assert.exists(forum.posts[1].attachments[0].video.title);
	  assert.exists(forum.posts[1].attachments[0].link.title)
    }
  }

  @test('should query with populate')
  async testPopulate() {
    const parser = new MongooseQueryParser();
    const qry = 'title&populate=createdBy.name,createdBy.email,likedBy';
    const parsed = parser.parse(qry);
    let populate: any[] = parsed.populate;
    assert.exists(populate);
    assert.isTrue(populate.length == 2);
    for (const p of populate) {
      assert.isTrue(['createdBy', 'likedBy'].includes(p.path));
      if (p.select) {
        assert.isTrue(p.select == 'name email');
      }
    }
    assert.exists(parsed.filter);
    const records = await PopulateTester.Post.find(parsed.filter).populate(populate).lean();
    for (const post of records) {
      assert.exists(post.createdBy.name);
      assert.exists(post.likedBy);
    }
  }
}
