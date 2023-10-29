const mongoose = require('mongoose')

const Fan = new mongoose.Schema({
    username:{ 
        type: String,
        required: true
    },
    readReceipt:{ 
        type: Boolean,
        required: false
    },
})

const Model = new mongoose.Schema({
    username:{ 
        type: String,
        required: true
    },
    readReceipt:{ 
        type: Boolean,
        required: false
    },
})

const Messages = new mongoose.Schema({
    fan: Fan,
    model: Model,
    chatMessages:{ 
        type: Array,
        required: false
    },
    lastUpdated:{ 
        type: Number,
        required: false
    }
})

module.exports = mongoose.model('Messages', Messages)