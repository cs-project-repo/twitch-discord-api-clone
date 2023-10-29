const mongoose = require('mongoose')

const Values = new mongoose.Schema({
    amount:{ 
        type: Number,
        required: true
    },
    recipient:{ 
        type: String,
        required: true
    }
})

const Maps = new mongoose.Schema({
    key:{ 
        type: String,
        required: true
    },
    value: Values
})

module.exports = mongoose.model('Maps', Maps)