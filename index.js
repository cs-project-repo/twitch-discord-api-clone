require('dotenv').config()
const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const mongoose = require('mongoose')
const https = require ("https");
const sslCredentials = require("./sslCredentials")
const SocketServer = require('./socket/SocketServer')
const WebRTCServer = require('./webrtc/WebRTCServer')
const cookieParser = require("cookie-parser")
const bodyParser = require('body-parser')
const corsOptions = require('./config/corsOptions') 
const router = require('./routes/routes')
const middlewareCredentials = require('./middleware/credentials')
const dashboardCronJob = require('./cron/dashboardCronJob')
const { PeerServer } = require("peer");

const app = express()

mongoose.set("strictQuery", false)
mongoose.connect(process.env.DATABASE_URL)
const db = mongoose.connection

db.on('error', (error) => console.error(error))
db.once('open', () => console.log('Connected to Mongo DB'))

app.use(middlewareCredentials)
app.use(cors(corsOptions))

app.use(express.json({ limit: "100mb" }))

app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

const socketPort = 8040
SocketServer.listen(socketPort, () => {
	console.log(`HTTPS Socket.io Server running on port ${socketPort}`);
})

const webRtcPort = 9000
WebRTCServer.listen(webRtcPort, () => {
	console.log(`HTTPS WebRTC Server running on port ${webRtcPort}`);
})

const limiter = rateLimit({
	windowMs: 10 * 60 * 1000, 
	max: 100,
	standardHeaders: true, 
	legacyHeaders: false,
	skipFailedRequests: false,
	skipSuccessfulRequests: false,
	handler: function(req, res /*, next*/) {
	  res.status(429).json({"message": "Rate limit exceeded! Please try again in 10 minutes!"});
	},
	onLimitReached: function(/*req, res, optionsUsed*/) {}
})

app.use(limiter)

app.use(cookieParser())

app.use('/app', router)

const mainPort = 8000

https.createServer(sslCredentials, app).listen(mainPort, () => {
	console.log(`HTTPS Server running on port ${mainPort}`);
});