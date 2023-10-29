const nodemailer = require("nodemailer")
const { google } = require('googleapis')

const oAuth2Client = new google.auth.OAuth2(process.env.CLIENT_ID, process.env.CLIENT_SECRET, process.env.REDIRECT_URI)
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN })

let sendEmail = new Promise(async (resolve, reject) => {
    const accessToken = await oAuth2Client.getAccessToken()
    let transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        service: "gmail",
        auth:{
            type: 'OAuth2',
            user: process.env.OAUTH2_EMAIL,
            clientId: process.env.CLIENT_ID, 
            clientSecret: process.env.CLIENT_SECRET,
            refreshToken: process.env.REFRESH_TOKEN,
            accessToken: accessToken
        }
    })
    transporter.verify(function(error, success) {
        if (error) {
            reject(error)
        } else {
            try{
                async () => {
                    await transporter.sendMail({
                        from: `Site Inc. <${process.env.OAUTH2_EMAIL}>`,
                        to: email,
                        subject: "Site Email Confirmation",
                        html: `Please click the link to confirm your account: <a href="${url}">Click Here!</a>`
                    }, (error, info) => {
                        if (error) {
                            reject(error)
                        }
                        resolve();
                    })
                }
            }catch(err){
                console.log(err)
                reject(err)
            }
    
        }
    });
})

sendEmail.then(async() => { 
    //
}).catch((err) =>{
    res.status(400).json({"message": "Email confirmation failed to send. Retry signup!"})
})