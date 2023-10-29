require('dotenv').config()
const express = require('express')
const axios = require('axios')
const bcrypt = require('bcrypt')
const router = express.Router()
const jwt = require('jsonwebtoken')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp');
const arraysEqual = require('../utils/arraysEqual')
const verifyJWT = require('../middleware/verifyJWT.js')
const verifyAPIKey = require('../middleware/verifyAPIKey.js')
const verifyCSRF = require('../middleware/verifyCSRF.js')
const { v4: uuidv4 } = require('uuid')
const formidable = require('formidable')
const sgMail = require('@sendgrid/mail')
const Users = require('../models/users')
const Messages = require('../models/messages')
const Maps = require('../models/maps')

const ROLES = {
    'fan': [2001, 1000],
    'creator': [2001, 1001]
}

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

/*[x]*/router.post('/createUser', async (req, res) => {
    const { email, username, password, roles, referral } = req.body
    try{
        if(!email || !username || !password) return res.status(400).json({ 'message': "Invalid Signup credentials!" })
        if(await Users.find({ "public.username": username.toLowerCase() }).count() > 0) return res.status(409).json({ 'message': "This Username is taken!" })
        if(await Users.find({ "secured.email": email.toLowerCase() }).count() > 0) return res.status(409).json({ 'message': "This Email already exists!" })

        let sendEmail = new Promise((resolve, reject) => {
            try{
                jwt.sign(
                { "user": username },
                process.env.ACCESS_TOKEN_SECRET,
                { expiresIn: '1d' },
                async (err, emailToken) => {
                    const url = `${process.env.BACKEND_URL}/confirmUser/${emailToken}`

                    const msg = {
                        to: email,
                        from: 'Site Inc. <admin@site>',
                        subject: 'Site Email Confirmation',
                        text: 'Please click the link to confirm your account: Click Here!',
                        html: `Please click the link to confirm your account: <a href="${url}">Click Here!</a>`
                    }

                    sgMail.send(msg)
                    .then(() => {resolve()}, error => {
                      reject(error)
                    })
                })
            }catch(err){
                console.log(err)
                reject(err)
            }
        })

        sendEmail.then(async() => {
            const newPassword = await bcrypt.hash(password, 10)
            const user = new Users({
                public:{
                    username: username.toLowerCase(),
                    roles: roles,
                    activated: arraysEqual(roles, ROLES.creator) ? false : null,
                    confirmed: false,
                    created: Date.now(),
                    activity:{
                        onlineStatus: "Active"
                    }
                },
                secured:{
                    email: email.toLowerCase(),
                    balance:{
                        current: arraysEqual(roles, ROLES.creator) ? 0 : null,
                        timeline: arraysEqual(roles, ROLES.creator) ? new Array(15).fill({ date: '...', amount: 0 }) : null,
                        totals:{
                            overall: arraysEqual(roles, ROLES.creator) ? 0 : null,
                            weekly: arraysEqual(roles, ROLES.creator) ? 0 : null
                        }
                    }
                },
                forbidden:{
                    password: newPassword,
                    referral: referral
                }
            })
            const newUser = user.save(async (err) => {
                if(err){
                    res.status(500).json({"message": "Something went wrong!"})
                } else {
                    res.status(200).json({"message": "User account successfully created!" })
                    return
                }
            })
        }).catch((err) =>{
            res.status(400).json({"message": "Email confirmation failed to send. Retry signup!"})
        })

    }catch (err){
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.get('/confirmUser/:token', async (req, res) => {
    try{
        jwt.verify(
            req.params.token, 
            process.env.ACCESS_TOKEN_SECRET,
            (err, decoded) => {
                if (err) throw err
                Users.updateOne({ "public.username": decoded.user.toLowerCase() }, { $set: { "public.confirmed": true }}, function(err, res) {  if (err) throw err })
                res.redirect(`${process.env.FRONTEND_URL}/confirm/${req.params.token}`)
            })
    }catch(err){
        res.redirect(`${process.env.FRONTEND_URL}/confirm/${req.params.token}`)
    }
})

/*[x]*/router.get('/confirmCheck/:token', async (req, res) => {
    try{
        jwt.verify(
            req.params.token, 
            process.env.ACCESS_TOKEN_SECRET,
            async (err, decoded) => {
                if (err) return res.status(403).json("Invalid JWT Token, Create a new account!")
                if(await Users.find({ "public.username": decoded.user.toLowerCase() }).count() === 0) throw err
                const foundByUsername = await Users.find({ "public.username": decoded.user.toLowerCase() })

                const accessToken = jwt.sign(
                    { "user": decoded.user },
                    process.env.ACCESS_TOKEN_SECRET,
                    { expiresIn: '5s' }
                )
                const refreshToken = jwt.sign(
                    { "user": decoded.user },
                    process.env.REFRESH_TOKEN_SECRET,
                    { expiresIn: '1d' }
                )

                Users.updateOne({ "public.username": decoded.user.toLowerCase() }, { $set: { "forbidden.tokens.refresh": refreshToken, "public.activity.onlineStatus": "Active" }}, function(err, res) {  if (err) throw err })

                res.status(200).json({"message": { user: foundByUsername[0].public, accessToken: accessToken, refreshToken: refreshToken }})
            })
    }catch(err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/activateUser', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const form = new formidable.IncomingForm()

        form.parse(req, async (err, fields, files) => {
            if (err) {
                console.error(err);
                res.status(500).json({ message: 'Error uploading file' });
                return;
            }

            function fileToBase64(filePath) {
                return new Promise((resolve, reject) => {
                  fs.readFile(filePath, (err, data) => {
                    if (err) {
                      reject(err);
                    } else {
                      const base64 = data.toString('base64');
                      resolve(base64);
                    }
                  });
                });
            }
            
            const base64ToBuffer = (base64String) => {
                const byteCharacters = atob(base64String);
                const byteArrays = [];
              
                for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
                  const slice = byteCharacters.slice(offset, offset + 1024);
              
                  const byteNumbers = new Array(slice.length);
                  for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                  }
              
                  const byteArray = new Uint8Array(byteNumbers);
              
                  byteArrays.push(byteArray);
                }
              
                const buffer = Buffer.concat(byteArrays);
                return buffer;
            }

            const { username, roles, description, chats, liveChats, photos, initialMessage } = fields

            // if(!arraysEqual(roles.split(','), ROLES.creator)) return res.status(400).json({ 'message': "Invalid Activation credentials!" })

            const images = [];

            const leftBase64 = await fileToBase64(files.left.filepath);
            images.push(leftBase64);
          
            const upperRightBase64 = await fileToBase64(files.upperRight.filepath);
            images.push(upperRightBase64);
          
            const lowerRightBase64 = await fileToBase64(files.lowerRight.filepath);
            images.push(lowerRightBase64);
          
            let update = new Promise((resolve, reject) => {
                Users.updateOne({ "public.username": username.toLowerCase() }, { $set: { "public.images": [...images], "public.description": description, "public.prices": { chats: chats, liveChats: liveChats, photos: photos }, "public.initialMessage": initialMessage, "public.activity.onlineStatus": "Active", "public.activated": true, "public.created": Date.now() }}, function(err, res) {
                    if (err) {
                        reject(err)
                    }else{
                        resolve()
                    }
                })
            })

            const compressBase64 = async (base64String, quality = 90) => {
                const buffer = Buffer.from(base64String, 'base64');
              
                const compressedBuffer = await sharp(buffer).jpeg({ quality }).toBuffer();
              
                const compressedBase64 = compressedBuffer.toString('base64');
              
                return compressedBase64;
            }

            const replaceBase64WithBuffers = async (foundUser) => {
                const images = foundUser.public.images;
                const promises = images.map(async (base64String) => {
                    const compressedBase64 = await compressBase64(base64String)
                    return base64ToBuffer(compressedBase64)
                });
                const buffers = await Promise.all(promises);
                foundUser.public.images = buffers;
                return foundUser.public;
            }
    
            update.then(async() => { 
                const foundUser = await Users.find({ "public.username": username.toLowerCase() })
                res.status(200).json({"message": { public: await replaceBase64WithBuffers(foundUser[0]), secured: foundUser[0].secured }})
            }).catch((err) =>{
                throw err
            })
        });

    }catch (err){
        console.log(err)
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.put('/updateUser', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const form = new formidable.IncomingForm()

        form.parse(req, async (err, fields, files) => {
            if (err) {
                console.error(err);
                res.status(500).json({ message: 'Error uploading file' });
                return;
            }

            function fileToBase64(filePath) {
                return new Promise((resolve, reject) => {
                  fs.readFile(filePath, (err, data) => {
                    if (err) {
                      reject(err);
                    } else {
                      const base64 = data.toString('base64');
                      resolve(base64);
                    }
                  });
                });
            }
            
            const base64ToBuffer = (base64String) => {
                const byteCharacters = atob(base64String);
                const byteArrays = [];
              
                for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
                  const slice = byteCharacters.slice(offset, offset + 1024);
              
                  const byteNumbers = new Array(slice.length);
                  for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                  }
              
                  const byteArray = new Uint8Array(byteNumbers);
              
                  byteArrays.push(byteArray);
                }
              
                const buffer = Buffer.concat(byteArrays);
                return buffer;
            }

            const { username, description, chats, liveChats, photos, initialMessage } = fields

            const images = [];

            const leftBase64 = await fileToBase64(files.left.filepath);
            images.push(leftBase64);
          
            const upperRightBase64 = await fileToBase64(files.upperRight.filepath);
            images.push(upperRightBase64);
          
            const lowerRightBase64 = await fileToBase64(files.lowerRight.filepath);
            images.push(lowerRightBase64);
          
            let update = new Promise((resolve, reject) => {
                Users.updateOne({ "public.username": username.toLowerCase() }, { $set: { "public.images": [...images], "public.description": description, "public.prices": { chats: chats, liveChats: liveChats, photos: photos }, "public.initialMessage": initialMessage }}, function(err, res) {
                    if (err) {
                        reject(err)
                    }else{
                        resolve()
                    }
                })
            })

            const compressBase64 = async (base64String, quality = 90) => {
                const buffer = Buffer.from(base64String, 'base64');
              
                const compressedBuffer = await sharp(buffer).jpeg({ quality }).toBuffer();
              
                const compressedBase64 = compressedBuffer.toString('base64');
              
                return compressedBase64;
            }

            const replaceBase64WithBuffers = async (foundUser) => {
                const images = foundUser.public.images;
                const promises = images.map(async (base64String) => {
                    const compressedBase64 = await compressBase64(base64String)
                    return base64ToBuffer(compressedBase64)
                });
                const buffers = await Promise.all(promises);
                foundUser.public.images = buffers;
                return foundUser.public;
            }
    
            update.then(async() => { 
                const foundUser = await Users.find({ "public.username": username.toLowerCase() })
                res.status(200).json({"message": { public: await replaceBase64WithBuffers(foundUser[0]), secured: foundUser[0].secured }})
            }).catch((err) =>{
                throw err
            })
        });
        
    }catch (err){
        console.log(err)
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/loginUser', async (req, res) => {
    try{
        const { user, password } = req.body

        if(!user || !password) return res.status(400).json({ 'message': "Incorrect Username or Password!" })
        if(await Users.find({ "public.username": user.toLowerCase() }).count() === 0 && await Users.find({ "secured.email": user.toLowerCase()}).count() === 0) return res.status(401).json({ 'message': "This User doesn't exist!" })
        const foundByUsername = await Users.find({ "public.username": user.toLowerCase() })
        const foundByEmail = await Users.find({ "secured.email": user.toLowerCase() })
        const emailConfirmation = foundByUsername[0]?.public.username != null ? foundByUsername[0].public.confirmed : foundByEmail[0].public.confirmed
        if(!emailConfirmation) return res.status(400).json({ 'message': "Confirm your email to login!" })
        const match = await bcrypt.compare(password, foundByUsername[0]?.forbidden.password != null ? foundByUsername[0].forbidden.password : foundByEmail[0].forbidden.password) 
        if(match){
            const accessToken = jwt.sign(
                { "user": user.toLowerCase() },
                process.env.ACCESS_TOKEN_SECRET,
                { expiresIn: '5s' }
            )
            const refreshToken = jwt.sign(
                { "user": user.toLowerCase() },
                process.env.REFRESH_TOKEN_SECRET,
                { expiresIn: '1d' }
            )

            let returnedUser
            const csrfToken = uuidv4()
            let update = new Promise(async (resolve, reject) => {
                if(foundByUsername.length !== 0){
                    Users.updateOne({ "public.username": user.toLowerCase() }, { $set: { "forbidden.tokens.refresh": refreshToken, "forbidden.tokens.csrf": csrfToken, "public.activity.onlineStatus": "Active" }}, function(err, res) {
                        if (err) {
                            reject(err)
                        }else{
                            resolve()
                        }
                    })
                    returnedUser = await Users.find({ "public.username": user.toLowerCase() }, { "public.images": 0 })
                }else if(foundByEmail.length !== 0){
                    Users.updateOne({ "secured.email": user.toLowerCase() }, { $set: { "forbidden.tokens.refresh": refreshToken, "forbidden.tokens.csrf": csrfToken, "public.activity.onlineStatus": "Active" }}, function(err, res) {
                        if (err) {
                            reject(err)
                        }else{
                            resolve()
                        }
                    })
                    returnedUser = await Users.find({ "secured.email": user.toLowerCase() }, { "public.images": 0 })
                }
            })
    
            update.then(async() => {
                res.status(200).json({"message": { user: returnedUser[0].public, accessToken: accessToken, refreshToken: refreshToken, csrfToken: csrfToken }})
            }).catch((err) =>{
                throw err
            })
        } else {
            res.status(401).json({ 'message': "Incorrect Username or Password!" })
        }

    }catch (err){
        console.log(err)
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.get('/refreshToken', async (req, res) => {
    try{
        const refreshJWT = req.headers.authorization.split(' ')[1]
        if(!refreshJWT) return res.status(401).json({ 'message': "No JWT Token!" })
        if(await Users.find({ "forbidden.tokens.refresh": refreshJWT }).count() === 0) return res.status(403).json({ 'message': "Invalid JWT Token, Please refresh page!" })
        const foundByRefreshToken = await Users.find({ "forbidden.tokens.refresh": refreshJWT })
        const user = [foundByRefreshToken[0].public.username, foundByRefreshToken[0].secured.email]
        jwt.verify(
            refreshJWT,
            process.env.REFRESH_TOKEN_SECRET,
            (err, decoded) => {
                if (err || !user.includes(decoded.user.toLowerCase())) return res.status(403).json({ 'message': "Invalid JWT Token, Please refresh page!" })
                const accessToken = jwt.sign(
                    { "user": decoded.user.toLowerCase() },
                    process.env.ACCESS_TOKEN_SECRET,
                    { expiresIn: '1m' }
                )

                const csrfToken = foundByRefreshToken[0].forbidden.tokens.csrf
                res.status(200).json({ "message": { user: foundByRefreshToken[0].public, accessToken: accessToken, csrfToken: csrfToken } })
            }
        )
    }catch (err){
        console.log("Error in refresh: "+err)
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.get('/logoutUser', async (req, res) => {
    try{
        const refreshJWT = req.headers.authorization.split(' ')[1]
        if(!refreshJWT) return res.sendStatus(204)
        if(await Users.find({ "forbidden.tokens.refresh": refreshJWT }).count() === 0) return res.status(403).json({ 'message': "Invalid JWT Token!" })
        const foundByRefreshToken = await Users.find({ "forbidden.tokens.refresh": refreshJWT })
        if(Users.find({ "forbidden.tokens.refresh": refreshJWT }).count() === 0){
            res.clearCookie('jwt', { sameSite: 'none', secure: true })
            res.status(400).json({"message": 'User not found!'})
        }

        Users.updateOne({ "public.username": foundByRefreshToken[0].public.username }, { $set: { "public.activity.onlineStatus": "Inactive", "public.activity.lastIn": Date.now(), "forbidden.tokens.csrf": "" }}, function(err, res) {  if (err) throw err })
        res.clearCookie('jwt', { sameSite: 'none', secure: true })
        res.status(200).json({"message": 'Successfully logged out!'})
    }catch (err){
        console.log("Error in sign out: "+err)
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/sendRequest', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { fan, creator } = req.body

        const foundByUsername = await Users.find({ "public.username": creator.toLowerCase() })
        const requests = [...foundByUsername[0].public.requests]
        if(!foundByUsername[0].public.requests.includes(fan)){
            requests.unshift(fan)
            Users.updateOne({ "public.username": creator.toLowerCase() }, { $set: { "public.requests": [...requests] }}, function(err, res) {  if (err) throw err })
            res.sendStatus(204)
        }else{
            res.status(400).json({"message": 'Request has already been sent!'})
        }
    }catch (err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/getRequests', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { creator } = req.body

        const creatorFoundByUsername = await Users.find({ "public.username": creator.toLowerCase() })
        const requests = [...creatorFoundByUsername[0].public.requests]

        if(requests.length === 0) return res.sendStatus(204)

        const newRequests = []
        for(var i=0; i < requests.length; i++){
            const fanFoundByUsername = await Users.find({ "public.username": requests[i].toLowerCase() })
            newRequests.push(fanFoundByUsername[0].public)
        }

        res.status(200).json({"message": newRequests})
    }catch (err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/paymentCheck', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { username } = req.body

        const foundUser = await Users.find({ "public.username": username.toLowerCase() })

        const paymentMethods = await stripe.paymentMethods.list({
            customer: foundUser[0].forbidden.customerId,
            type: 'card',
        })

        if(paymentMethods?.data?.length === 0)  return res.status(409).json({ 'message': "No cards found for this user!" })

        res.sendStatus(204)
        // res.status(200).json({"message": paymentMethods})
    }catch (err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/setupPayment', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { username, creator, items, tip } = req.body

        const foundUser = await Users.find({ "public.username": username.toLowerCase() })

        let customerId
        await stripe.customers.create({
            name: username,
            email: foundUser[0].forbidden.email
        })
        .then(customer => {
            customerId = customer.id
            Users.updateOne({ "public.username": username.toLowerCase() }, { $set: { "forbidden.customerId": customerId } }, function(err, res) {
                if (err) throw err;
            });
        })
        .catch(error => {
            throw error
        })
        
        const setupIntent = await stripe.setupIntents.create({
            customer: customerId,
            payment_method_types: ['bancontact', 'card', 'ideal'],
        });

        const foundCreator = await Users.find({ "public.username": creator.toLowerCase() })

        const prices = foundCreator[0].public.prices
        const price = items.map((item) => prices[item] || 0).reduce((a, b) => Number(a) + Number(b), Number(tip) || 0)

        const paymentIntent = await stripe.paymentIntents.create({
          amount: price * 100,
          currency: "usd"
        });
        
        const map = new Maps({
            key: paymentIntent.id,
            value:{
                recipient: creator,
                amount: price * 100
            }
        })
        const newMap = map.save(async (err) => {
            if(err){
                res.status(500).json({"message": "Something went wrong!"})
            } else {
                res.status(200).json({"message": { paymentIntentSecret: paymentIntent.client_secret, setupIntentSecret: setupIntent.client_secret }});
                return
            }
        })
    }catch (err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/quickPayment', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { username, creator, items, tip } = req.body

        const foundUser = await Users.find({ "public.username": username.toLowerCase() })
        const foundCreator = await Users.find({ "public.username": creator.toLowerCase() })

        const prices = foundCreator[0].public.prices
        const price = items.map((item) => prices[item] || 0).reduce((a, b) => Number(a) + Number(b), Number(tip) || 0)
        console.log("Prices: ", price)

        const paymentMethods = await stripe.paymentMethods.list({
            customer: foundUser[0].forbidden.customerId,
            type: 'card',
        })

        try {
            const paymentIntent = await stripe.paymentIntents.create({
              amount: price * 100,
              currency: 'usd',
              customer: foundUser[0].forbidden.customerId,
              payment_method: paymentMethods.data[0].id,
              off_session: true,
              confirm: true,
            });
        
            const map = new Maps({
                key: paymentIntent.id,
                value:{
                    recipient: creator,
                    amount: price * 100
                }
            })
            const newMap = map.save(async (err) => {
                if(err){
                    res.status(500).json({"message": "Something went wrong!"})
                } else {
                    res.status(200).json({"message": { paymentIntent: paymentIntent }})
                    return
                }
            })

        } catch (err) {
            console.log('Error code is: ', err.code);
            const paymentIntentRetrieved = await stripe.paymentIntents.retrieve(err.raw.payment_intent.id);
            console.log('PI retrieved: ', paymentIntentRetrieved.id);
        }
    }catch (err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/addToBalance', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { paymentIntent } = req.body

        if(await Maps.find({ "key": paymentIntent.id }).count === 0) return res.status(409).json({ 'message': "This payment doesn't exist!" })
        if(paymentIntent.status !== "succeeded") return res.status(409).json({ 'message': "This payment is invalid!" })

        const foundMap = await Maps.find({ "key": paymentIntent.id })
        const amount = foundMap[0].value.amount
        const recipient = foundMap[0].value.recipient

        let update = new Promise((resolve, reject) => {
            Maps.deleteOne( { "key": paymentIntent.id } , function(err, res) {
                if (err) {
                    reject(err)
                }else{
                    resolve()
                }
            })
        })

        update.then(async() => { 
            if(amount !== paymentIntent.amount) return res.status(409).json({ 'message': "Invalid transaction amount!" })

            const foundUser =  await Users.find({ "public.username": recipient.toLowerCase() })

            const threeMonthsInMs = 3 * 30 * 24 * 60 * 60 * 1000;
            const currentDate = Date.now()
    
            const remainingAmount = (currentDate - foundUser[0].public.created >= threeMonthsInMs) ? (amount / 100) * 0.85 : (amount / 100) * 0.88
    
            Users.updateOne({ "public.username": recipient.toLowerCase() }, { $inc: { "secured.balance.current": remainingAmount, "secured.balance.totals.overall": remainingAmount,  "secured.balance.totals.weekly": remainingAmount } }, function(err, res) {
                if (err) throw err;
            });
    
            res.sendStatus(204)
        }).catch((err) =>{
            throw err
        })

    }catch (err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[ ]*/router.post('/setupPayout', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { username, roles } = req.body
        if(!arraysEqual(roles, ROLES.creator)) return res.status(409).json({ 'message': "User is not authorized to access this feature!" })

        const foundUser = await Users.find({ "public.username": username.toLowerCase() })

        if(!foundUser[0].public.activated) return res.status(409).json({ 'message': "This account is not activated yet!" })

        let accountId 
        if(!foundUser[0]?.forbidden?.accountId){
            const account = await stripe.accounts.create({
                // country: 'us',
                type: 'standard',
                // capabilities: {card_payments: {requested: true}, transfers: {requested: true}},
            })
            accountId = account.id

            Users.updateOne({ "public.username": username.toLowerCase() }, { $set: { "forbidden.accountId": accountId } }, function(err, res) {
                if (err) throw err;
            });
        }else{
            accountId = foundUser[0].forbidden.accountId
        }
        const accountLink = await stripe.accountLinks.create({
            account: accountId,
            refresh_url: process.env.FRONTEND_URL,
            return_url: process.env.FRONTEND_URL,
            type: 'account_onboarding',
        });
        res.status(200).json({"message": accountLink.url})
        // res.sendStatus(204)
        
        // const setupIntent = await stripe.setupIntents.create({
        //     customer: customerId,
        //     payment_method_types: ['bancontact', 'card', 'ideal'],
        // });

        // res.status(200).json({"message": { setupIntentSecret: setupIntent.client_secret }});
    }catch (err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[ ]*/router.post('/payout', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { username } = req.body

        const foundUser = await Users.find({ "public.username": username.toLowerCase() })

        const paymentMethods = await stripe.paymentMethods.list({
            customer: foundUser[0].forbidden.customerId,
            type: 'card',
        })

        // console.log(paymentMethods?.data[0]?.id)
        res.sendStatus(204)
    }catch (err){
        res.status(400).json({"message": 'Something went wrong!'})
    }
})

/*[x]*/router.post('/getUserDashboardData', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { username } = req.body

        if(await Users.find({ "public.username": username.toLowerCase() }).count() === 0) return res.status(401).json({ 'message': "This User doesn't exist!" })

        const foundUser = await Users.find({ "public.username": username.toLowerCase() })
            
        const base64ToBuffer = (base64String) => {
            const byteCharacters = atob(base64String);
            const byteArrays = [];
          
            for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
              const slice = byteCharacters.slice(offset, offset + 1024);
          
              const byteNumbers = new Array(slice.length);
              for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
              }
          
              const byteArray = new Uint8Array(byteNumbers);
          
              byteArrays.push(byteArray);
            }
          
            const buffer = Buffer.concat(byteArrays);
            return buffer;
        }

        const compressBase64 = async (base64String, quality = 90) => {
            const buffer = Buffer.from(base64String, 'base64');
          
            const compressedBuffer = await sharp(buffer).jpeg({ quality }).toBuffer();
          
            const compressedBase64 = compressedBuffer.toString('base64');
          
            return compressedBase64;
        }

        const replaceBase64WithBuffers = async (foundUser) => {
            const images = foundUser.public.images;
            const promises = images.map(async (base64String) => {
                const compressedBase64 = await compressBase64(base64String)
                return base64ToBuffer(compressedBase64)
            });
            const buffers = await Promise.all(promises);
            foundUser.public.images = buffers;
            return foundUser.public;
        }

        res.status(200).json({"message": { public: await replaceBase64WithBuffers(foundUser[0]), secured: foundUser[0].secured }})
    }catch (err){
        res.status(400).json({"message": "Something went wrong"})
    }
})

/*[x]*/router.get('/getCreators', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const users = await Users.find({})
        const creators = []
        const activatedCreators = []
        for(var i=0; i<users.length; i++){
            if(arraysEqual(users[i].public.roles, ROLES.creator)){
                creators.push(users[i].public)
            }
        }
        for(var i=0; i<creators.length; i++){

            if(creators[i].images.length !== 3) continue
            if(creators[i].activated){

                const base64ToBuffer = (base64String) => {
                    const byteCharacters = atob(base64String);
                    const byteArrays = [];
                  
                    for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
                      const slice = byteCharacters.slice(offset, offset + 1024);
                  
                      const byteNumbers = new Array(slice.length);
                      for (let i = 0; i < slice.length; i++) {
                        byteNumbers[i] = slice.charCodeAt(i);
                      }
                  
                      const byteArray = new Uint8Array(byteNumbers);
                  
                      byteArrays.push(byteArray);
                    }
                  
                    const buffer = Buffer.concat(byteArrays);
                    return buffer;
                }

                const compressBase64 = async (base64String, quality = 90) => {
                    const buffer = Buffer.from(base64String, 'base64');

                    const compressedBuffer = await sharp(buffer).jpeg({ quality }).toBuffer();
                  
                    const compressedBase64 = compressedBuffer.toString('base64');
                  
                    return compressedBase64;
                }
        
                const replaceBase64WithBuffers = async (creator) => {
                    const images = creator.images;
                    const promises = images.map(async (base64String) => {
                        const compressedBase64 = await compressBase64(base64String);
                        return base64ToBuffer(compressedBase64);
                    });
                    const buffers = await Promise.all(promises);
                    creator.images = buffers;
                    return creator;
                };

                activatedCreators.push(await replaceBase64WithBuffers(creators[i]))
            }
        }

        res.status(200).json({"message": activatedCreators})
    }catch (err){
        console.log(err)
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.get('/getLiveCreators', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const users = await Users.find({})
        const creators = []
        const activatedCreators = []
        for(var i=0; i<users.length; i++){
            if(arraysEqual(users[i].public.roles, ROLES.creator)){
                creators.push(users[i].public)
            }
        }
        for(var i=0; i<creators.length; i++){

            if(creators[i].images.length !== 3) continue
            if(creators[i].activated && creators[i].activity.onlineStatus === "Live"){

                const base64ToBuffer = (base64String) => {
                    const byteCharacters = atob(base64String);
                    const byteArrays = [];
                  
                    for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
                      const slice = byteCharacters.slice(offset, offset + 1024);
                  
                      const byteNumbers = new Array(slice.length);
                      for (let i = 0; i < slice.length; i++) {
                        byteNumbers[i] = slice.charCodeAt(i);
                      }
                  
                      const byteArray = new Uint8Array(byteNumbers);
                  
                      byteArrays.push(byteArray);
                    }
                  
                    const buffer = Buffer.concat(byteArrays);
                    return buffer;
                }

                const compressBase64 = async (base64String, quality = 90) => {
                    const buffer = Buffer.from(base64String, 'base64');

                    const compressedBuffer = await sharp(buffer).jpeg({ quality }).toBuffer();
                  
                    const compressedBase64 = compressedBuffer.toString('base64');
                  
                    return compressedBase64;
                }
        
                const replaceBase64WithBuffers = async (creator) => {
                    const images = creator.images;
                    const promises = images.map(async (base64String) => {
                        const compressedBase64 = await compressBase64(base64String);
                        return base64ToBuffer(compressedBase64);
                    });
                    const buffers = await Promise.all(promises);
                    creator.images = buffers;
                    return creator;
                };

                activatedCreators.push(await replaceBase64WithBuffers(creators[i]))
            }
        }

        res.status(200).json({"message": activatedCreators})
    }catch (err){
        console.log(err)
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.post('/sendMessage', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { sender, fan, creator, chatMessage } = req.body

        if(await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }).count() === 0){
            const chatMessages = []
            chatMessages.push(chatMessage)
            const message = new Messages({
                creator:{
                    username: creator
                },
                fan:{
                    username: fan
                },
                chatMessages: [...chatMessages],
                lastUpdated: Date.now()
            })
            const newMessage = message.save(async (err) => {
                if(err){
                    res.status(500).json({"message": "Something went wrong!"})
                } else {
                    if(sender.toLowerCase() === fan.toLowerCase()){
                        Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "creator.readReceipt": true, "fan.readReceipt": false } }, function(err, res) {
                            if (err) throw err;
                        });
                    } else if(sender.toLowerCase() === creator.toLowerCase()){
                        Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "creator.readReceipt": false, "fan.readReceipt": true } }, function(err, res) {
                            if (err) throw err;
                        });
                    }
                    res.status(200).json({"message": [...chatMessages]})
                    return
                }
            })
        }else{
            const chatMessages = await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() })
            const newChatMessages = [...chatMessages[0].chatMessages]
            newChatMessages.push(chatMessage)

            let update = new Promise((resolve, reject) => {
                Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "chatMessages": [...newChatMessages], "lastUpdated": Date.now() } }, function(err, res) {
                    if (err) {
                        reject(err)
                    }else{
                        resolve()
                    }
                })
            })
    
            update.then(async() => { 
                if(sender.toLowerCase() === fan.toLowerCase()){
                    Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "creator.readReceipt": true, "fan.readReceipt": false } }, function(err, res) {
                        if (err) throw err;
                    });
                } else if(sender.toLowerCase() === creator.toLowerCase()){
                    Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "creator.readReceipt": false, "fan.readReceipt": true } }, function(err, res) {
                        if (err) throw err;
                    });
                }
                res.status(200).json({"message": [...newChatMessages]})
                return
            }).catch((err) =>{
                throw err
            })
        }
    }catch (err){
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.post('/sendPhoto', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { sender, fan, creator, chatMessage } = req.body

        if(await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }).count() === 0){
            const chatMessages = []
            chatMessages.push(chatMessage)
            const photo = new Messages({
                creator:{
                    username: creator
                },
                fan:{
                    username: fan
                },
                chatMessages: [...chatMessages],
                lastUpdated: Date.now()
            })
            const newPhoto = photo.save(async (err) => {
                if(err){
                    res.status(500).json({"message": "Something went wrong!"})
                } else {
                    if(sender.toLowerCase() === fan.toLowerCase()){
                        Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "creator.readReceipt": true, "fan.readReceipt": false } }, function(err, res) {
                            if (err) throw err;
                        });
                    } else if(sender.toLowerCase() === creator.toLowerCase()){
                        Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "creator.readReceipt": false, "fan.readReceipt": true } }, function(err, res) {
                            if (err) throw err;
                        });
                    }
                    res.status(200).json({"message": [...chatMessages]})
                    return
                }
            })
        }else{
            const chatMessages = await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() })
            const newChatMessages = [...chatMessages[0].chatMessages]
            newChatMessages.push(chatMessage)

            let update = new Promise((resolve, reject) => {
                Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "chatMessages": [...newChatMessages], "lastUpdated": Date.now() } }, function(err, res) {
                    if (err) {
                        reject(err)
                    }else{
                        resolve()
                    }
                })
            })
    
            update.then(async() => { 
                if(sender.toLowerCase() === fan.toLowerCase()){
                    Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "creator.readReceipt": true, "fan.readReceipt": false } }, function(err, res) {
                        if (err) throw err;
                    });
                } else if(sender.toLowerCase() === creator.toLowerCase()){
                    Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "creator.readReceipt": false, "fan.readReceipt": true } }, function(err, res) {
                        if (err) throw err;
                    });
                }
                res.status(200).json({"message": [...newChatMessages]})
            }).catch((err) =>{
                throw err
            })
        }
    }catch (err){
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.post('/sendMassMessage', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    const { creator, chatMessage } = req.body
    try{
        const userMessages = await Messages.find({ "creator.username": creator.toLowerCase() })
        
        const fans = []
        for(var i=0; i < userMessages.length; i++){
            fans.push(userMessages[i].fan.username)
        }
        
        for(var i=0; i < fans.length; i++){
            const chatMessages = await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fans[i].toLowerCase() })
            const newChatMessages = [...chatMessages[0].chatMessages]
            newChatMessages.push(chatMessage)
            let update = new Promise((resolve, reject) => {
                Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fans[i].toLowerCase() }, { $set: { "chatMessages": [...newChatMessages], "lastUpdated": Date.now(), "creator.readReceipt": false, "fan.readReceipt": true } }, function(err, res) {
                    if (err) {
                        reject(err)
                    }else{
                        resolve()
                    }
                })
            })
    
            update.then(async() => { 
                return
            }).catch((err) =>{
                throw err
            })
        }
        res.sendStatus(204)
    }catch(err){
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.post('/sendMassPhoto', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    const { creator, chatMessage } = req.body
    try{
        const userMessages = await Messages.find({ "creator.username": creator.toLowerCase() })
        
        const fans = []
        for(var i=0; i < userMessages.length; i++){
            fans.push(userMessages[i].fan.username)
        }
        
        for(var i=0; i < fans.length; i++){
            const chatMessages = await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fans[i].toLowerCase() })
            const newChatMessages = [...chatMessages[0].chatMessages]
            newChatMessages.push(chatMessage)
            let update = new Promise((resolve, reject) => {
                Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fans[i].toLowerCase() }, { $set: { "chatMessages": [...newChatMessages], "lastUpdated": Date.now(), "creator.readReceipt": false, "fan.readReceipt": true } }, function(err, res) {
                    if (err) {
                        reject(err)
                    }else{
                        resolve()
                    }
                })
            })
    
            update.then(async() => { 
                return
            }).catch((err) =>{
                throw err
            })
        }
        res.sendStatus(204)
    }catch(err){
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.post('/getUserMessages', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { user, roles } = req.body 
        
        let messages
        if(arraysEqual(roles, ROLES.creator)){
            messages = await Messages.find({ "creator.username": user.toLowerCase() })
        }else{
            messages = await Messages.find({ "fan.username": user.toLowerCase() })
        }

        if(messages.length === 0) return res.sendStatus(204)

        const userMessages = []
        for(var i=0; i < messages.length; i++){
            let user

            if(arraysEqual(roles, ROLES.creator)){
                user = await Users.find({ "public.username": messages[i].fan.username.toLowerCase() })
            } else{
                user = await Users.find({ "public.username": messages[i].creator.username.toLowerCase() })
            }

            const base64ToBuffer = (base64String) => {
                const byteCharacters = atob(base64String);
                const byteArrays = [];
              
                for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
                  const slice = byteCharacters.slice(offset, offset + 1024);
              
                  const byteNumbers = new Array(slice.length);
                  for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                  }
              
                  const byteArray = new Uint8Array(byteNumbers);
              
                  byteArrays.push(byteArray);
                }
              
                const buffer = Buffer.concat(byteArrays);
                return buffer;
            }
    
            const compressBase64 = async (base64String, quality = 90) => {
                const buffer = Buffer.from(base64String, 'base64');
              
                const compressedBuffer = await sharp(buffer).jpeg({ quality }).toBuffer();
              
                const compressedBase64 = compressedBuffer.toString('base64');
              
                return compressedBase64;
            }
    
            const replaceBase64WithBuffers = async (foundUser) => {
                const images = foundUser.public.images;
                const promises = images.map(async (base64String) => {
                    const compressedBase64 = await compressBase64(base64String)
                    return base64ToBuffer(compressedBase64)
                });
                const buffers = await Promise.all(promises);
                foundUser.public.images = buffers;
                return foundUser.public;
            }

            userMessages.push({ user: await replaceBase64WithBuffers(user[0]), messages: messages[i] })
        }

        if(userMessages.length === 0) return res.sendStatus(204)

        userMessages.sort((a, b) => b.messages.lastUpdated - a.messages.lastUpdated)

        res.status(200).json({"message": userMessages})
    }catch (err){
        console.log("Error in messages: "+err)
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.post('/getChatMessages', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { fan, creator } = req.body

        if(await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }).count() === 0) return res.status(200).json({"message": []})

        const chatMessages = await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() })

        res.status(200).json({"message": chatMessages[0].chatMessages})
    }catch (err){
        console.log(err)
        res.status(400).json({"message": "Something went wrong!"})
    }
})

/*[x]*/router.delete('/removeMessage', verifyAPIKey, verifyCSRF, verifyJWT, async (req, res) => {
    try{
        const { fan, creator, index } = req.body

        const chatMessages = await Messages.find({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() })
        const newChatMessages = [...chatMessages[0].chatMessages]

        newChatMessages.splice(index, 1)
        let update = new Promise((resolve, reject) => {
            Messages.updateOne({ "creator.username": creator.toLowerCase(), "fan.username": fan.toLowerCase() }, { $set: { "chatMessages": [...newChatMessages] } }, function(err, res) {
                if (err) {
                    reject(err)
                }else{
                    resolve()
                }
            })
        })

        update.then(async() => { 
            res.status(200).json({"message": [...newChatMessages]})
        }).catch((err) =>{
            throw err
        })
    }catch (err){
        res.status(400).json({"message": "Something went wrong!"})
    }
})

module.exports = router