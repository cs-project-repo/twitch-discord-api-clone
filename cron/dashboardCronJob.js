require('dotenv').config()
const Users = require('../models/users')
const arraysEqual = require('../utils/arraysEqual')
const cron = require('node-cron')
const shell = require('shelljs')

const ROLES = {
    'fan': [2001, 1000],
    'creator': [2001, 1001]
}

const everySecond = "* * * * * *"
const everyMinute = "* * * * *"
const everyWeek = "0 0 * * 1"
 
const dashboardCronJob = cron.schedule(everyWeek, async function(){
    const users = await Users.find({})
    const creators = []
    const activatedCreators = []
    for(var i=0; i<users.length; i++){
        if(arraysEqual(users[i].public.roles, ROLES.creator)){
            creators.push(users[i])
        }
    }
    for(var i=0; i<creators.length; i++){
        if(creators[i].public.activated){
            activatedCreators.push(creators[i])
        }
    }

    for(var i=0; i<activatedCreators.length; i++){
        let timeline = []
        const date = new Date().toLocaleDateString()
        if(activatedCreators[i].secured.balance.timeline.length === 0 ){
            timeline = new Array(15).fill({ date: '...', amount: 0 })
        }else{
            timeline = [...activatedCreators[i].secured.balance.timeline]
        } 

        const index = activatedCreators[i]?.secured?.balance.index || 0
        const weeklyTotal = activatedCreators[i]?.secured?.balance.totals.weekly || 0
        if(index < 15){
            const full = timeline.slice(0, index) 
            const empty = timeline.slice(index)
            const newEmpty = [...empty]
            const removeOldest = newEmpty.pop()
            const addCurrent = [...full]
            addCurrent.push({ date: date, amount: weeklyTotal })
            const newTimeline = addCurrent.concat(newEmpty)
            Users.updateOne({ "public.username": activatedCreators[i].public.username }, { $set: { "secured.balance.timeline": [...newTimeline], "secured.balance.totals.weekly": 0 }}, function(err, res) {  if (err) throw err })
            Users.updateOne({ "public.username": activatedCreators[i].public.username }, { $inc: { "secured.balance.index": 1 }}, function(err, res) {  if (err) throw err })
        } else {
            const newTimeline = [...timeline]
            const removeOldest = newTimeline.shift()
            const addCurrent = newTimeline.push({ date: date, amount: weeklyTotal })
            Users.updateOne({ "public.username": activatedCreators[i].public.username }, { $set: { "secured.balance.timeline": [...newTimeline], "secured.balance.totals.weekly": 0 }}, function(err, res) {  if (err) throw err })
        }
    }
})

module.exports = dashboardCronJob