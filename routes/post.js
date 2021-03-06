const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const multerS3 = require('multer-s3')
const AWS = require('aws-sdk')

const { Post, Comment, Image, User, Hashtag } = require('../models')
const { isLoggedIn } = require('./middlewares')

const router = express.Router()

const isProduction = process.env.NODE_ENV === 'production'
const serverUrl = isProduction ? process.env.SERVER : process.env.DEV_SERVER

/* uploads 폴더가 없어서 새로 생성 */
try {
	fs.accessSync('uploads')
} catch (err) {
	console.log('uploads 폴더가 없으므로 생성합니다.')
	fs.mkdirSync('uploads')
}

/* multer 미들웨어 선언 */
let upload
// /* 배포 모드에선 AWS S3 연결해야 함. */
// AWS.config.update({
//     accessKeyId: process.env.S3_ACCESS_KEY_ID,
//     secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
//     region: 'ap-northeast-2',
// })

// upload = multer({
//     storage: multerS3({
//         s3: new AWS.S3(), // multer와 S3 연결
//         bucket: 'fosel-react-nodebird',
//         key(req, file, cb) {
//             cb(null, `original/${Date.now()}_${path.basename(file.originalname)}`)
//         },
//     }),
//     limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
// })

upload = multer({
	storage: multer.diskStorage({
		destination(req, file, done) {
			done(null, 'uploads')
		},

		/* 랜디.jpg */
		filename(req, file, done) {
			const ext = path.extname(file.originalname) // 확장자 추출(.jpg)
			const basename = path.basename(file.originalname, ext) // 랜디
			done(null, basename + '_' + new Date().getTime() + ext) // 랜디_15184712891.jpg
		},
	}),
	limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
})

/* POST /post */
router.post('/', isLoggedIn, upload.none(), async (req, res, next) => {
	try {
		const hashtags = req.body.content.match(/#[^\s#]+/g)
		const post = await Post.create({
			content: req.body.content,
			UserEmail: req.user.email, // deserializeUser에서 req.user 만들어줌
		})

		/* 해쉬태그 처리 */
		if (hashtags) {
			/* 이미 존재하는 해쉬태그면 새로 생성해서 올릴 필요 없음 */
			const result = await Promise.all(
				hashtags.map((tag) =>
					Hashtag.findOrCreate({ where: { name: tag.slice(1).toLowerCase() } }),
				),
			) // return [hashtag, 생성됐는지아닌지여부]
			await post.addHashtags(result.map((v) => v[0]))
		}

		/* 이미지를 올린 경우 */
		if (req.body.image) {
			/* 이미지를 여러 개 올린 경우 image: [랜디.jpg, 제로초.jpg] */
			if (Array.isArray(req.body.image)) {
				const images = await Promise.all(
					req.body.image.map((image) => Image.create({ src: image })),
				) // DB엔 이미지 파일을 직접 올리지 않고 주소만 저장함.
				await post.addImages(images)
			} else {
				/* 이미지를 하나만 올린 경우 image: 랜디.jpg */
				const image = await Image.create({ src: req.body.image })
				await post.addImages(image)
			}
		}

		/* 정보를 완성해서 돌려주기 */
		const fullPost = await Post.findOne({
			where: { id: post.id },
			include: [
				{
					model: Image, // 첨부 이미지
				},
				{
					model: User, // 게시글 작성자
					attributes: ['email', 'nickname'],
				},
				{
					model: Comment, // 댓글
					include: [
						{
							model: User, // 댓글 작성자
							attributes: ['email', 'nickname'],
							order: [['createdAt', 'DESC']],
						},
					],
				},
				{
					model: User, // 좋아요 누른 사람
					as: 'Likers',
					attributes: ['email'],
				},
			],
		})
		res.status(201).json(fullPost)
	} catch (err) {
		console.error(err)
		next(err)
	}
})

/* GET /post/1 */
router.get('/:id', async (req, res, next) => {
	try {
		const id = parseInt(req.params.id, 10)
		const post = await Post.findOne({ where: { id } })

		if (!post) {
			return res.status(404).send('존재하지 않는 게시글입니다.')
		}

		/* 정보를 완성해서 돌려주기 */
		const fullPost = await Post.findOne({
			where: { id: post.id },
			include: [
				{
					model: Image, // 첨부 이미지
				},
				{
					model: User, // 게시글 작성자
					attributes: ['email', 'nickname'],
				},
				{
					model: Comment, // 댓글
					include: [
						{
							model: User, // 댓글 작성자
							attributes: ['email', 'nickname'],
							order: [['createdAt', 'DESC']],
						},
					],
				},
				{
					model: User, // 좋아요 누른 사람
					as: 'Likers',
					attributes: ['email'],
				},
			],
		})
		return res.status(201).json(fullPost)
	} catch (err) {
		console.error(err)
		next(err)
	}
})

/* PATCH /post/1 */
router.patch('/:id', isLoggedIn, upload.none(), async (req, res, next) => {
	try {
		const id = req.params.id
		const hashtags = req.body.content.match(/#[^\s#]+/g)
		const post = await Post.findOne({
			where: { id },
		})

		if (!post) {
			return res.status(403).send('존재하지 않는 게시글입니다.')
		}

		post.content = req.body.content

		/* 해쉬태그 처리 */
		if (hashtags) {
			/* 이미 존재하는 해쉬태그면 새로 생성해서 올릴 필요 없음 */
			const result = await Promise.all(
				hashtags.map((tag) =>
					Hashtag.findOrCreate({ where: { name: tag.slice(1).toLowerCase() } }),
				),
			) // return [hashtag, 생성됐는지아닌지여부]
			await post.setHashtags(result.map((v) => v[0]))
		}

		/* 이미지를 올린 경우 */
		if (req.body.image) {
			/* 이미지를 여러 개 올린 경우 image: [랜디.jpg, 제로초.jpg] */
			if (Array.isArray(req.body.image)) {
				const images = await Promise.all(
					req.body.image.map((image) => Image.create({ src: image })),
				) // DB엔 이미지 파일을 직접 올리지 않고 주소만 저장함.
				await post.setImages(images)
			} else {
				/* 이미지를 하나만 올린 경우 image: 랜디.jpg */
				const image = await Image.create({ src: req.body.image })
				await post.setImages(image)
			}
		}
		await post.save()

		/* 정보를 완성해서 돌려주기 */
		const fullPost = await Post.findOne({
			where: { id: post.id },
			include: [
				{
					model: Image, // 첨부 이미지
				},
				{
					model: User, // 게시글 작성자
					attributes: ['email', 'nickname'],
				},
				{
					model: Comment, // 댓글
					include: [
						{
							model: User, // 댓글 작성자
							attributes: ['email', 'nickname'],
							order: [['createdAt', 'DESC']],
						},
					],
				},
				{
					model: User, // 좋아요 누른 사람
					as: 'Likers',
					attributes: ['email'],
				},
			],
		})
		console.log(JSON.stringify(fullPost))
		res.status(201).json(fullPost)
	} catch (err) {
		console.error(err)
		next(err)
	}
})

/* DELETE /post/1 */
router.delete('/:id', isLoggedIn, async (req, res, next) => {
	try {
		const id = parseInt(req.params.id, 10)
		await Post.destroy({
			where: {
				id,
				UserEmail: req.user.email, // 내가 작성한 글만 삭제
			},
		})
		res.status(200).json({ id })
	} catch (err) {
		console.error(err)
		next(err)
	}
})

/* POST /post/images */
router.post('/images', isLoggedIn, upload.array(/* input name */ 'image'), (req, res, next) => {
	console.log('here?')
	console.log(req.files)
	res.json(req.files.map((v) => `${serverUrl}/images/${v.filename}`))
})

/* POST /post/1/comment */
router.post('/:postId/comment', isLoggedIn, async (req, res, next) => {
	try {
		const id = parseInt(req.params.postId, 10)
		/* 존재하지 않는 게시글에 댓글 작성하려고 하는 경우 */
		const post = await Post.findOne({
			where: { id },
		})
		if (!post) {
			return res.status(403).send('존재하지 않는 게시글입니다.')
		}

		const comment = await Comment.create({
			content: req.body.content,
			PostId: id,
			UserEmail: req.user.email, // deserializeUser에서 req.user 만들어줌
		}) // comment 생성하고 DB에 저장

		const fullComment = await Comment.findOne({
			where: {
				id: comment.id,
			},
			include: [{ model: User, attributes: ['email', 'nickname'] }],
		}) // 추가로 코멘트 작성자 정보 넘겨줌
		res.status(201).json(fullComment)
	} catch (err) {
		console.error(err)
		next(err)
	}
})

/* PATCH /post/1/like */
router.patch('/:id/like', isLoggedIn, async (req, res, next) => {
	try {
		const id = parseInt(req.params.id, 10)
		const post = await Post.findOne({
			where: { id },
		})
		/* id가 postId인 게시글이 존재하지 않으면 */
		if (!post) {
			return res.status(403).send('게시글이 존재하지 않습니다.')
		}

		/* 존재하면 */
		await post.addLikers(req.user.email)
		res.json({ PostId: post.id, UserEmail: req.user.email })
	} catch (err) {
		console.error(err)
		next(err)
	}
})

/* DELETE /post/1/like */
router.delete('/:id/like', isLoggedIn, async (req, res, next) => {
	try {
		const id = parseInt(req.params.id, 10)
		const post = await Post.findOne({
			where: { id },
		})
		/* id가 postId인 게시글이 존재하지 않으면 */
		if (!post) {
			return res.status(403).send('게시글이 존재하지 않습니다.')
		}

		/* 존재하면 */
		await post.removeLikers(req.user.email)
		res.status(200).json({ PostId: post.id, UserEmail: req.user.email })
	} catch (err) {
		console.error(err)
		next(err)
	}
})

/* POST /post/1/retweet */
router.post('/:id/retweet', isLoggedIn, async (req, res, next) => {
	try {
		const id = parseInt(req.params.id, 10)
		/* 존재하지 않는 게시글에 댓글 작성하려고 하는 경우 */
		const post = await Post.findOne({
			where: { id },
			include: [
				{
					model: Post,
					as: 'Retweet',
				}, // RetweetId도 붙여서 읽어옴.
			],
		})
		if (!post) {
			return res.status(403).send('존재하지 않는 게시글입니다.')
		}

		/* 남이 리트윗한 내 글을 내가 다시 리트윗하는 경우는 막음 */
		if (post.Retweet && post.Retweet.UserEmail === req.user.email) {
			return res.status(403).send('리트윗된 자신의 글을 다시 리트윗할 수 없습니다.')
		}

		const retweetTargetId = post.RetweetId || post.id // 리트윗된 적이 있으면 그대로 유지

		/* 이미 리트윗했는지 검사 */
		const exPost = await Post.findOne({
			where: {
				UserEmail: req.user.email,
				RetweetId: retweetTargetId,
			},
		})
		if (exPost) {
			return res.status(403).send('이미 리트윗했습니다.')
		}

		/* 리트윗은 원래 기존 글을 공유하는 개념이므로 Post 새로 생성 */
		const retweet = await Post.create({
			UserEmail: req.user.email,
			RetweetId: retweetTargetId,
			content: 'retweet', // content 비워두면 안돼서 채워둠
		})

		/* 리트윗 된 게시글 가져옴 */
		const retweetWithPrevPost = await Post.findOne({
			where: { id: retweet.id },
			include: [
				{
					model: User, // 리트윗 한 사용자
					attributes: ['email', 'nickname'],
				},
				{
					model: Image,
				},
				{
					model: Comment,
					include: [
						{
							model: User,
							attributes: ['email', 'nickname'],
							order: [['createdAt', 'DESC']],
						},
					],
				},
				{
					model: User,
					as: 'Likers',
					attributes: ['email'],
				},
				{
					model: Post, // 리트윗 된 게시물 내용
					as: 'Retweet',
					include: [
						{
							model: User,
							attributes: ['email', 'nickname'],
						},
						{
							model: Image,
						},
					],
				},
			],
		})
		res.status(201).json(retweetWithPrevPost)
		// 이런식으로 한꺼번에 가져오면 query 처리 속도가 엄청나게 느려짐.
		// 쪼개줘야 함. (댓글은 따로 불러오게 처리한다든지)
	} catch (err) {
		console.error(err)
		next(err)
	}
})

module.exports = router
