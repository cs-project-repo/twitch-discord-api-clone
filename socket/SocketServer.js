const app = require(process.env.APP_PATH)
const http = require('http')
const corsOptions = require('../config/corsOptions')
const { Server } = require('socket.io')
const { v4: uuidv4 } = require('uuid')
var SHA256 = require('crypto-js/sha256')
const Users = require('../models/users')
const Messages = require('../models/messages')

const SocketServer = http.createServer(app)

const io = new Server(SocketServer, {
	path: '/socketio/',
	cors: corsOptions
})

const viewers = {}
const chatlogs = {}

io.on('connection', (socket) => {

	const removeViewer = (socketId) => {
		for (const roomId in viewers) {
		  const index = viewers[roomId].indexOf(socketId)
		  if (index !== -1) {
			viewers[roomId].splice(index, 1)
			const views = viewers[roomId]?.length || 0
      		io.to(roomId).emit('getLiveStreamViews', views)
		  }
		}
	}

	socket.on('disconnect', () => {
		const socketId = socket.id
		removeViewer(socketId)
		removeChatlog(socketId)
	})

	socket.on('connectUsers', async (data) => {
		const connectionId = uuidv4()
		socket.broadcast.emit('userConnecting', { connectedUser: data.connectedUser, connectingUser: data.connectingUser, connectionId: connectionId }) 
		socket.join(connectionId)
	})

	socket.on('userConnected', async ({ connectionId, connectingUser }) => {
		socket.join(connectionId)
		const seed = uuidv4()
		const nonce = Math.floor(Math.random() * 10**10)
		const roomId = SHA256(seed + nonce).toString()
		io.to(connectionId).emit('secureConnection', { roomId: roomId })
		io.in(connectionId).socketsLeave(connectionId)
	})

	socket.on('userNotConnecting', async (data) => {
		socket.broadcast.emit('userNotConnected', { connectedUser: data.connectedUser, connectingUser: data.connectingUser }) 
	})

	socket.on('disconnectUsers', async ({ connectedUser, connectingUser, location }) => { 
		const user = await Users.find({ 'public.username': connectedUser.toLowerCase() })
		const requests = [...user[0].public.requests]
		const index = requests.indexOf(connectingUser)
		requests.splice(index, 1)
		Users.updateOne({ 'public.username': connectedUser.toLowerCase() }, { $set: { "public.requests": [...requests] }}, function(err, res) {  if (err) throw err })
		io.emit('userDisconnecting', { connectedUser: connectedUser, connectingUser: connectingUser }) 
	})

	socket.on('joinLiveChat', async ({ roomId, userId }) => {
		const sockets = await io.in(roomId).fetchSockets()
		if(sockets.length < 2){
			socket.join(roomId)
			Users.updateOne({ 'public.username': userId.toLowerCase() }, { $set: { "public.activity.onlineStatus": "In call" }}, function(err, res) {  if (err) throw err })
			if(sockets.length === 1){
				io.to(roomId).emit('startLiveChat', 60)
			}
		} else if(!socket.rooms.has(roomId)) {
			socket.emit('fullRoom', roomId );
		}
	})

	socket.on('swapUserData', (data) => {
		if(socket.rooms.has(data.roomId)){
			socket.to(data.roomId).emit('userDataSwapped', { userId: data.userId })
		}
	})

	socket.on('viewableState', (data) => {
		if(socket.rooms.has(data.roomId)){
			socket.to(data.roomId).emit('getViewableState', data)
		}
	})

	socket.on('updateTimer', (data) => {
		if(socket.rooms.has(data.roomId)){
			io.in(data.roomId).emit('addMinute', 60)
		}
	})

	socket.on('disconnectFromLiveChat', async (data) => {
		Users.updateOne({ 'public.username': data.userId.toLowerCase() }, { $set: { "public.activity.onlineStatus": "Active" }}, function(err, res) {  if (err) throw err })
		socket.to(data.roomId).emit('liveChatDisconnection')
	})

	socket.on('joinChat', async (data) => {
		socket.join(data.roomId)
	})
	
	socket.on('updateChat', async (data) => {
		const chatMessages = await Messages.find({ "model.username": data.model.toLowerCase(), "fan.username": data.fan.toLowerCase() })
		socket.broadcast.to(data.roomId).emit('refreshChat', chatMessages[0].chatMessages)
	})
	
	socket.on('isTyping', async (data) => {
		socket.to(roomId).emit('hasTyped', { roomId: data.roomId, userTyping: data.userTyping })
	})

	socket.on('isNotTyping', async (data) => {
		socket.to(roomId).emit('hasNotTyped', { roomId: data.roomId, userTyping: data.userTyping })
	})

	socket.on('disconnectFromChat', async (data) => {
		socket.leave(data.roomId)
	})

	socket.on('startLiveStream', async (data, callback) => {
		const seed = uuidv4()
		const nonce = Math.floor(Math.random() * 10**10)
		const roomId = SHA256(seed + nonce).toString()

		callback(roomId) 
	})

	socket.on('streamerJoinLiveStream', async (data, callback) => {
		socket.join(data.roomId)

		Users.updateOne({ "public.username": data.userId.toLowerCase() }, { $set: { "public.activity.onlineStatus": "Live", "public.activity.roomIds.live": data.roomId }}, function(err, res) {  if (err) throw err })
	})

	socket.on('joinLiveStream', async ({ roomId }) => {
		const socketId = socket.id
		socket.join(roomId)

		if (viewers.hasOwnProperty(roomId)) {
			if (!viewers[roomId].includes(socketId)) {
			  viewers[roomId].push(socketId)
			}
		} else {
			viewers[roomId] = [socketId]
		}

		const views = viewers[roomId]?.length || 0
		io.to(roomId).emit('getLiveStreamViews', views)
	})

	socket.on('getStreamerUsername', async ({ roomId }, callback) => {
		if(await Users.find({ "public.activity.roomIds.live": roomId }).count() === 0) return

		const foundUser = await Users.find({ "public.activity.roomIds.live": roomId })
		callback(foundUser[0].public.username)
	})

	socket.on('getLiveStreamViews', async ({ roomId }, callback) => {
		const views = viewers[roomId]?.length || 0
		callback(views)
	})

	socket.on('addLiveStreamChatMessage', async ({ roomId, chatMessage }) => {
		//
		if (!chatlogs[roomId]) {
			chatlogs[roomId] = { chats: [] };
		}

		chatlogs[roomId].chats.unshift(chatMessage)
		io.to(roomId).emit('getLiveStreamChatMessages', chatlogs[roomId].chats)
	})

	socket.on('liveStreamChatMessages', ({ roomId }, callback) => {
		if (!chatlogs[roomId]) {
			chatlogs[roomId] = { chats: [] };
		}

		callback(chatlogs[roomId].chats)
	})

	socket.on('disconnectFromLiveStream', async (data) => {
		Users.updateOne({ 'public.username': data.userId.toLowerCase() }, { $set: { 'public.activity.onlineStatus': 'Active', "public.activity.roomIds.live": "" }}, function(err, res) {  if (err) throw err })
		socket.to(data.roomId).emit('liveStreamDisconnection')
	})

	socket.on('activateUser', async (data) => {
		const user = await Users.find({ 'public.username': data.userId.toLowerCase() })
		Users.updateOne({ 'public.username': data.userId.toLowerCase() }, { $set: { 'public.activity.onlineStatus': data.onlineStatus }}, function(err, res) {  if (err) throw err })
	})

	socket.on('inactivateUser', async (data) => {
		const user = await Users.find({ 'public.username': data.userId.toLowerCase() })
		Users.updateOne({ 'public.username': data.userId.toLowerCase() }, { $set: { 'public.activity.onlineStatus': data.onlineStatus, 'public.activity.lastIn': Date.now() }}, function(err, res) {  if (err) throw err })
	})
})

module.exports = SocketServer;