const path = require ("path");
const fs = require ("fs");

const privateKey = fs.readFileSync('/etc/letsencrypt/live/relaypeer.live/privkey.pem', 'utf8');
const certificate = fs.readFileSync('/etc/letsencrypt/live/relaypeer.live/cert.pem', 'utf8');
const ca = fs.readFileSync('/etc/letsencrypt/live/relaypeer.live/chain.pem', 'utf8');

const sslCredentials = {
	key: privateKey,
	cert: certificate,
	ca: ca
};

module.exports = sslCredentials;