const mongoose = require('mongoose')

const RoomIds = new mongoose.Schema({
    live:{ 
        type: String,
        required: false
    }
})

const Activity = new mongoose.Schema({
    onlineStatus:{ 
        type: String,
        required: false
    },
    lastIn:{ 
        type: Number,
        required: false
    },
    roomIds: RoomIds,
})

const Prices = new mongoose.Schema({
    chats:{ 
        type: Number,
        required: false
    },
    liveChats:{ 
        type: Number,
        required: false
    },
    photos:{ 
        type: Number,
        required: false
    }
})

const PublicData = new mongoose.Schema({
    username:{
        type: String,
        required: true
    },
    roles:{ 
        type: Array,
        required: true
    },
    activity: Activity,
    images:{ 
        type: Array,
        required: false
    },
    description:{ 
        type: String,
        required: false
    },
    prices: Prices,
    activated:{ 
        type: Boolean,
        required: false
    },
    requests:{
        type: Array,
        required: false
    },
    confirmed:{
        type: Boolean,
        required: false
    },
    initialMessage:{
        type: String,
        required: false
    },
    created:{
        type: Number,
        required: true
    }
})

const Totals = new mongoose.Schema({
    overall:{ 
        type: Number,
        required: false
    },
    weekly:{ 
        type: Number,
        required: false
    }
})

const Balances = new mongoose.Schema({
    current:{ 
        type: Number,
        required: false
    },
    totals: Totals,
    timeline:{ 
        type: Array,
        required: false
    },
    index:{
        type: Number,
        required: false
    }
})

const SecuredData = new mongoose.Schema({
    email:{
        type: String,
        required: true
    },
    balance: Balances,
})

const Tokens = new mongoose.Schema({
    refresh:{ 
        type: String,
        required: false
    },
    csrf:{ 
        type: String,
        required: false
    }
})

const ForbiddenData = new mongoose.Schema({
    password:{ 
        type: String,
        required: true
    },
    referral:{ 
        type: String,
        required: false
    },
    customerId:{
        type: String,
        required: false
    },
    accountId:{
        type: String,
        required: false
    },
    tokens: Tokens,
})

const Users = new mongoose.Schema({
    public: PublicData,
    secured: SecuredData,
    forbidden: ForbiddenData
}) 

module.exports = mongoose.model('Users', Users)