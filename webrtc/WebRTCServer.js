const app = require(process.env.APP_PATH)
const { RTCPeerConnection, RTCSessionDescription, MediaStream } = require('wrtc');
const http = require('http');
const wrtc = require('wrtc')
const corsOptions = require('../config/corsOptions')
const { Server } = require("socket.io")
const cron = require('node-cron')
const mediasoup = require('mediasoup')
const axios = require('axios')
const { v4: uuidv4 } = require('uuid')
var SHA256 = require("crypto-js/sha256")

const WebRTCServer = http.createServer(app)

const io = new Server(WebRTCServer, {
	path: "/webrtc/",
	cors: corsOptions
})

const rooms = {}
const lives = {} 
const streamers = {} 

let worker
const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 5000,
  })

  worker.on('died', error => {
    // console.log("mediasoup worker has died")
    setTimeout(() => process.exit(1), 2000)
  })

  return worker
}

worker = createWorker()

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
    scalabilityMode: 'S3T3_KEY',
  },
]

io.on('connection', async (socket) => {

  const removeRoom = (socketId) => {
    const roomId = Object.keys(rooms).find(key => rooms[key].socketId === socketId);
    if (roomId) {
      delete rooms[roomId];
    }
  } 

  const removeLive = (socketId) => {
    for (const roomId in lives) {
      if (lives.hasOwnProperty(roomId) && lives[roomId].socketId === socketId) {
        delete lives[roomId];
      }
    }
  }

  const removeViewer = (socketId) => {
    for (const roomId in lives) {
      if (lives.hasOwnProperty(roomId)) {
        const room = lives[roomId];
        if (room.viewers.hasOwnProperty(socketId)) {
          delete room.viewers[socketId];
        }
      }
    }
  } 

  socket.on('disconnect', () => {
    const socketId = socket.id
    removeRoom(socketId)
    removeLive(socketId)
    removeViewer(socketId)
    // console.log("Deleted updated lives: ", lives)
    // console.log('Client disconnected')
  })

  socket.on('initialize', async ({ offer, roomId }, callback) => {
    const socketId = socket.id
    socket.join(roomId)
    if(!roomId) return
    if (rooms.hasOwnProperty(roomId)) {
      // console.log('initialized', roomId)
      const storedOffer = rooms[roomId]?.offer
      socket.emit('initialized', storedOffer)
      
      callback(undefined)
    } else {
      // console.log('initializing', roomId)
      rooms[roomId] = { offer, socketId }
      socket.to(roomId).emit('initialized', offer)

      const sockets = await io.in(roomId).fetchSockets()
      if(sockets.length >= 2){
        // console.log("Deleting room...")
        delete rooms[roomId]
      }

      callback(offer) 
    }
  })

  socket.on('answer', (data) => {
    // console.log('Received answer:', answer)
    socket.to(data.roomId).emit('answered', data.answer)
  })

  socket.on('candidate', (data) => {
    // console.log('Received candidate:', candidate)
    socket.to(data.roomId).emit('candidate', data.candidate)
  })

  // * * //

  socket.on('getRtpCapabilities', async ({ roomId, userId }, callback) => {
    const socketId = socket.id
    
    if(!lives[roomId]){
      const router = await worker.createRouter({ mediaCodecs })
      const rtpCapabilities = router.rtpCapabilities
  
      callback({ rtpCapabilities }) 

      lives[roomId] = { router, userId, socketId, viewers: {} }
    }else{
      if(lives[roomId].socketId !== socketId){
        socket.emit('streamerFound')
      }
    }
  })

  socket.on('requestRtpCapabilities', async ({ roomId }, callback) => {
    if(lives[roomId]){
      const rtpCapabilities = lives[roomId].router.rtpCapabilities

      callback({ rtpCapabilities }) 
    }else{
      socket.emit('noRoomFound')
    }
  })

  socket.on('createProducerTransport', async ({ roomId }, callback) => {
    const router = lives[roomId].router
    const room = lives[roomId]
    
    const producerTransport = await createWebRtcTransport(router, callback)
    // console.log("Created producerTransport: ", producerTransport)

    const updatedRoom = {
      ...room,
      producerTransport: producerTransport
    }

    lives[roomId] = updatedRoom
    // console.log("Producer live: ", lives)
  })

  socket.on('createConsumerTransport', async ({ roomId }, callback) => {
    const socketId = socket.id
    socket.join(roomId)

    const router = lives[roomId].router 
    const consumerTransport = await createWebRtcTransport(router, callback)

    const viewer = lives[roomId].viewers[socketId] || {}

    const updatedViewer = {
      ...viewer,
      consumerTransport: consumerTransport
    }

    lives[roomId].viewers[socketId] = updatedViewer
    // console.log("Consumer live: ", lives)
  })

  const createWebRtcTransport = async (router, callback) => {
    try{
      const options = {
        listenIps: [
          {
            ip: JSON.parse(process.env.PRODUCTION_ENVIRONMENT) ? process.env.SERVER_PUBLIC_IP_ADDRESS : '127.0.0.1',
            announcedIp: JSON.parse(process.env.PRODUCTION_ENVIRONMENT) ? process.env.SERVER_PUBLIC_IP_ADDRESS : undefined
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true
      }

      const transport = await router.createWebRtcTransport(options)

      transport.on('dtlsstatechange', dtlsState => {
        if(dtlsState === 'closed'){
          transport.close()
        }
      })

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters 
        }
      })

      return transport
    }catch(error){
      console.log(error)
    }
  }

  socket.on('connectProducer', async ({ dtlsParameters, roomId }, callback) => {
    const producerTransport = lives[roomId].producerTransport
    await producerTransport.connect({ dtlsParameters })
    // console.log("connecting...", producerTransport)
  })

  socket.on('produceProducer', async ({ kind, rtpParameters, appData, roomId }, callback) => {
    const room = lives[roomId]
    const producerTransport = lives[roomId].producerTransport
    if(kind === "video"){
      const videoProducer = await producerTransport.produce({ 
        kind,
        rtpParameters 
      })
  
      // console.log("Created videoProducer: ", videoProducer, videoProducer.id)
      // videoProducerId = videoProducer.id
  
      videoProducer.on('transportclose', () => {
        // console.log('transport closed')
        videoProducer.close()
      })
  
      callback({
        id: videoProducer.id
      })

      const updatedRoom = {
        ...room,
        videoProducer: videoProducer,
        videoProducerId: videoProducer.id
      }

      lives[roomId] = updatedRoom
    }else if(kind === "audio"){
      const audioProducer = await producerTransport.produce({ 
        kind,
        rtpParameters 
      })
  
      // console.log("Created audioProducer: ", audioProducer, audioProducer.id)
      // audioProducerId = audioProducer.id
  
      audioProducer.on('transportclose', () => {
        // console.log('transport closed')
        audioProducer.close()
      })
  
      callback({
        id: audioProducer.id
      })

      const updatedRoom = {
        ...room,
        audioProducer: audioProducer,
        audioProducerId: audioProducer.id
      }

      lives[roomId] = updatedRoom
    }
  })

  socket.on('connectConsumer', async ({ dtlsParameters, roomId }, callback) => {
    const socketId = socket.id

    const consumerTransport = lives[roomId].viewers[socketId].consumerTransport
    await consumerTransport.connect({ dtlsParameters })
    // console.log("consuming...", consumerTransport)
  })

  socket.on('consume', async ({ rtpCapabilities, roomId }, callback) => {
    // console.log("Saved lives: ", lives)
    const socketId = socket.id

    const videoProducerId = lives[roomId].videoProducerId
    const audioProducerId = lives[roomId].audioProducerId
    // console.log("Producers: ", videoProducerId, audioProducerId)

    try{
      const router = lives[roomId].router
      // console.log("Can consume video? ", router.canConsume({ producerId: videoProducerId, rtpCapabilities: rtpCapabilities }))
      // console.log("Can consume audio? ", router.canConsume({ producerId: audioProducerId, rtpCapabilities: rtpCapabilities }))

      const canConsumeVideo = router.canConsume({
        producerId: videoProducerId,
        rtpCapabilities: rtpCapabilities
      });
      
      const canConsumeAudio = router.canConsume({
        producerId: audioProducerId,
        rtpCapabilities: rtpCapabilities
      })

      if(canConsumeVideo && canConsumeAudio){
        const consumerTransport = lives[roomId].viewers[socketId].consumerTransport

        const videoConsumer = await consumerTransport.consume({
          producerId: videoProducerId,
          rtpCapabilities,
          paused: true
        })

        const audioConsumer = await consumerTransport.consume({
          producerId: audioProducerId,
          rtpCapabilities,
          paused: true
        })

        videoConsumer.on('transportclose', () => {
          // console.log('transport closed')
        })

        videoConsumer.on('producerclose', () => {
          // console.log('transport closed')
        })

        audioConsumer.on('transportclose', () => {
          // console.log('transport closed')
        })

        audioConsumer.on('producerclose', () => {
          // console.log('transport closed')
        })

        const params = {
          videoId: videoConsumer.id,
          audioId: audioConsumer.id,
          videoProducerId: videoProducerId,
          audioProducerId: audioProducerId,
          videoRtpParameters: videoConsumer.rtpParameters,
          audioRtpParameters: audioConsumer.rtpParameters
        }

        callback({ params })

        const viewer = lives[roomId].viewers[socketId]

        const updatedViewer = {
          ...viewer,
          videoConsumer: videoConsumer,
          audioConsumer: audioConsumer
        }
    
        lives[roomId].viewers[socketId] = updatedViewer
      }
    }catch(error){
      console.log(error)
      callback({
        params: {
          error: error
        }
      })
    }
  })

  socket.on('resume', async ({ roomId }, callback) => {
    const socketId = socket.id

    const { videoConsumer, audioConsumer } = lives[roomId].viewers[socketId]

    // console.log("resuming...")
    await videoConsumer.resume()
    await audioConsumer.resume()

    callback(true)
  })

  // * * //

  socket.on('pauseState', async (data) => {
    socket.to(data.roomId).emit('getPauseState', data.paused)
  })

  socket.on('muteState', async (data) => {
    socket.to(data.roomId).emit('getMuteState', data.muted)
  })
})

module.exports = WebRTCServer;