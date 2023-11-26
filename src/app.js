require('dotenv').config();
const fs = require('fs');
const fsPromises = fs.promises;
const fileName = './padelMatches.json';
const padelMatch = require('./padelMatch');

const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TOKEN;
let padelMatches = [];
let chatId;

const loadMatches = async (owner = false) => {
    await fsPromises.readFile(fileName)
        .then(async (data) => {
            padelMatches = JSON.parse(data);
            if(owner) 
                padelMatches = await padelMatches.filter((m) => {
                    return m.owner.id == owner;
                });
            await padelMatches.sort((a,b) => new Date(a.dateTime) - new Date(b.dateTime));
        })
        .catch((err) => console.error('Failed to read file', err));
}

const storeMatches = async (matches) => {
    // Clear old matches
    matches = await matches.filter((m) => {
        return isFutureDate(m.dateTime); 
    });
    await fsPromises.writeFile(fileName, JSON.stringify(matches))
        .catch((err) => {
            bot.sendMessage(
                chatId,
                'Error! Match not saved',
            );
        });  
}

const validateDate = (string) => {
    let valid = true;
    var re = new RegExp(/([0-9]|[12][0-9]|3[01])\/([0-9]{2})\/([0-9]{2})/gm);
    if (!re.test(string))
        valid = false;
    return valid;
}

const isFutureDate = (date, object = true) => {
    if(object)
        newDate = new Date(date);
    else {
        d = date.split('/');
        newDate = new Date('20'+d[2], d[1]-1, d[0]);
    }
    return new Date(newDate.toDateString()) > new Date(new Date().toDateString());
}

const validateTime = (string) => {
    let valid = true;
    var re = new RegExp(/^([01]\d|2[0-3]):?([0-5]\d)$/gm);
    if (!re.test(string))
        valid = false;
    return valid;
}

const createDateTime = (date, time) => {
    d = date.split('/');
    t = time.split(':');
    return new Date('20'+d[2], d[1]-1, d[0], t[0],t[1]);
}

const getMatchesInfo = async () => {
    let matchesText = '';
    const dateOptions = {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'};
    const timeOptions = {hour: "numeric", minute: "numeric", hour12: false};
    await padelMatches.forEach(async (m, i) => {
        const dateTime = new Date(m.dateTime);
        if(i != 0)
            matchesText += `\n\n`;
        matchesText += `#${i+1}\nDate: <b>${dateTime.toLocaleDateString("en-US", dateOptions)}</b>\nTime: <b>${dateTime.toLocaleTimeString("en-US", timeOptions)}</b>\nPlace: <b>${m.place}</b>\nOwner: <b><a href="tg://user?id=${m.owner.id})">${m.owner.first_name}</a></b>`;
        // Retrieve players
        if(m.players.length){
            matchesText += `\nPlayers: `;
            await m.players.forEach((p) => matchesText += `<b><a href="tg://user?id=${p.id})">${p.first_name}</a></b> `);
        }
    });
    return matchesText;
}

const createMatchesKeyboard = async (action) => {
    let inlineKeyboard = [];
    const options = {day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'}
    await padelMatches.map((m, i) => {
        const dateTime = new Date(m.dateTime);
        inlineKeyboard.push({
            text: `#${i+1} ${dateTime.toLocaleDateString("es-ES", options)} ${m.place}`,
            callback_data: JSON.stringify({ action: action, matchId: String(m.id)})
        });
    });
    return inlineKeyboard;
}

// Created instance of TelegramBot
const bot = new TelegramBot(token, {
    polling: true
});

let answerCallbacks = {};
bot.on('message', function (msg) {
    var callback = answerCallbacks[msg.chat.id];
    if (callback) {
        delete answerCallbacks[msg.chat.id];
        return callback(msg);
    }
});

// Listener (handler) for telegram's /bookmark event
bot.onText(/\/create/, async (msg, match) => {
    await loadMatches();
    chatId = msg.chat.id;

    // Retrieve date, time and place
    bot.sendMessage(chatId, "Match date? (dd/mm/yy)").then(function () {
        answerCallbacks[chatId] = function (answer) {
            let date = answer.text;
            if(validateDate(date) && isFutureDate(date, false))
                bot.sendMessage(chatId, "Match time? (hh:mm military time)").then(function () {
                    answerCallbacks[chatId] = function (answer) {
                        let time = answer.text;
                        if(validateTime(time)){
                            bot.sendMessage(chatId, "Match place? Write \"unkown\" if already unknown").then(function () {
                                answerCallbacks[chatId] = function (answer) {
                                    let dateTime = createDateTime(date, time);
                                    let place = answer.text;
                                    let newMatch = new padelMatch(msg.from);
                                    newMatch.dateTime = dateTime;
                                    newMatch.place = place;

                                    padelMatches.push(newMatch);
                                    storeMatches(padelMatches)
                                        .then(() => bot.sendMessage(
                                            chatId,
                                            'Match has been successfully created!',
                                        ));
                                }
                            });
                        }
                        else
                            bot.sendMessage(chatId, "Invalid time!");
                    }
                });
            else
                bot.sendMessage(chatId, "Invalid date!");
        }
    });
});

// Listener (handler) for telegram's /label event
bot.onText(/\/list/, async (msg, match) => {
    await loadMatches();
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();
    if(!matchesInfo.length)
        return noMatches();
    bot.sendMessage(chatId, matchesInfo, {parse_mode: 'HTML'});
});

bot.onText(/\/update/, async (msg, match) => {
    await loadMatches();
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();

    if(!matchesInfo.length)
        return noMatches();

    inlineKeyboard = await createMatchesKeyboard('update');

    bot.sendMessage(
        chatId,
        'Which match do you want to <b>update</b>?\n\n' + matchesInfo,
        {
            reply_markup: JSON.stringify({
                inline_keyboard: [inlineKeyboard],
                resize_keyboard: true,
                one_time_keyboard: true,
            }),
            parse_mode: 'HTML'
        }
    );
});

const updateMatch = async (cb, matchId) => {
    await loadMatches();
    const chatId = cb.message.chat.id;
    const index = await padelMatches.findIndex((m) => m.id == matchId);


    // Retrieve date, time and place
    const prevDate = new Date(padelMatches[index].dateTime);
    bot.sendMessage(chatId, `New match date? Currently ${twoDigits(prevDate.getDate())}/${twoDigits(prevDate.getMonth() + 1)}/${twoDigits(String(prevDate.getFullYear()))}`).then(function () {
        answerCallbacks[chatId] = function (answer) {
            let date = answer.text;
            if(validateDate(date))
                bot.sendMessage(chatId, `New match time?  Currently ${twoDigits(prevDate.getHours())}:${twoDigits(prevDate.getMinutes())}`).then(function () {
                    answerCallbacks[chatId] = function (answer) {
                        let time = answer.text;
                        if(validateTime(time)){
                            bot.sendMessage(chatId, `New match place? Currently ${padelMatches[index].place}`).then(function () {
                                answerCallbacks[chatId] = async function (answer) {
                                    let dateTime = createDateTime(date, time);
                                    let place = answer.text;
                                    
                                    padelMatches[index].dateTime = dateTime;
                                    padelMatches[index].place = place;

                                    storeMatches(padelMatches)
                                        .then(() => bot.sendMessage(
                                            chatId,
                                            'Match has been successfully updated!',
                                        ));
                                }
                            });
                        }
                        else
                            bot.sendMessage(chatId, "Invalid time!");
                    }
                });
            else
                bot.sendMessage(chatId, "Invalid date!");
        }
    });
};    

bot.onText(/\/join/, async (msg, match) => {
    await loadMatches();
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();

    if(!matchesInfo.length)
        return noMatches();

    inlineKeyboard = await createMatchesKeyboard('join');

    bot.sendMessage(
        chatId,
        'Which match do you want to <b>join</b>?\n\n' + matchesInfo,
        {
            reply_markup: JSON.stringify({
                inline_keyboard: [inlineKeyboard],
                resize_keyboard: true,
                one_time_keyboard: true,
            }),
            parse_mode: 'HTML'
        }
    );
});

const joinMatch = async (cb, matchId) => {
    const chatId = cb.message.chat.id;
    await loadMatches();

    const index = await padelMatches.findIndex((m) => m.id == matchId);
   
    // Check match date
    if(!isFutureDate(padelMatches[index].dateTime))
        return bot.sendMessage(chatId, "Sorry this match was already played");

    // Check number of players
    if(padelMatches[index].players.length >= 4)
        return bot.sendMessage(chatId, "Match is full!");

    // Check player is not already enrolled
    if(padelMatches[index].players.length) {
        let valid = await padelMatches[index].players.every((p) => {
            return p.id != cb.from.id;
        });
        if(!valid)
            return bot.sendMessage(chatId, "You are already enrolled!");
    }

    // Add player
    padelMatches[index].players.push(cb.from);
    storeMatches(padelMatches)
        .then(() => bot.sendMessage(
            chatId,
            'You joined the match successfully!',
        ));
};

bot.onText(/\/leave/, async (msg, match) => {
    await loadMatches();
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();

    if(!matchesInfo.length)
        return noMatches();

    inlineKeyboard = await createMatchesKeyboard('leave');

    bot.sendMessage(
        chatId,
        'Which match do you want to <b>leave</b>?\n\n' + matchesInfo,
        {
            reply_markup: JSON.stringify({
                inline_keyboard: [inlineKeyboard],
                resize_keyboard: true,
                one_time_keyboard: true,
            }),
            parse_mode: 'HTML'
        }
    );
});

const leaveMatch = async (cb, matchId) => {
    const chatId = cb.message.chat.id;
    await loadMatches();
    const index = await padelMatches.findIndex((m) => m.id == matchId);
   
    // Check number of players
    if(!padelMatches[index].players.length)
        return bot.sendMessage(chatId, "There are no players");
    
    let valid = await padelMatches[index].players.find((p) => p.id == cb.from.id);

    if(valid == undefined)
        return bot.sendMessage(chatId, "You are not enrolled on this match!");

    let filteredPlayers = await padelMatches[index].players.filter((p) => {
        return p.id != cb.from.id;
    });

    // Add player
    padelMatches[index].players = filteredPlayers;
    storeMatches(padelMatches)
        .then(() => bot.sendMessage(
            chatId,
            'You left the match',
        ));
};

bot.onText(/\/delete/, async (msg, match) => {
    await loadMatches(msg.from.id);
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();

    if(!matchesInfo.length)
        return noMatches();

    inlineKeyboard = await createMatchesKeyboard('delete');

    bot.sendMessage(
        chatId,
        'Which match do you want to <b>delete</b>? <em>Only matches you own</em>\n\n' + matchesInfo,
        {
            reply_markup: JSON.stringify({
                inline_keyboard: [inlineKeyboard],
                resize_keyboard: true,
                one_time_keyboard: true,
            }),
            parse_mode: 'HTML'
        }
    );
});

const deleteMatch = async (cb, matchId) => {
    const chatId = cb.message.chat.id;
    await loadMatches();

    padelMatches = padelMatches.filter((m) => {
        return m.id != matchId
    });
    storeMatches(padelMatches)
        .then(() => bot.sendMessage(
            chatId,
            'Match deleted',
        ));
};

// Listener (handler) for callback data from /join command
bot.on('callback_query', (callbackQuery) => {
    const data = JSON.parse(callbackQuery.data);

    switch (data.action) {
        case 'join':
            joinMatch(callbackQuery, data.matchId);
            break;
        case 'update':
            updateMatch(callbackQuery, data.matchId);
            break;
        case 'leave':
            leaveMatch(callbackQuery, data.matchId);
            break;
        case 'delete':
            deleteMatch(callbackQuery, data.matchId);
            break;
        default:
            bot.sendMessage(chatId, "Action not recognized");
    }
});

const twoDigits = (string) => {
    return ("0" + string).slice(-2);
}

const noMatches = () => {
    bot.sendMessage(chatId, 'There are no matches', {parse_mode: 'HTML'});
}

// Listener (handler) for telegram's /start event
// This event happened when you start the conversation with both by the very first time
// Provide the list of available commands
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
        chatId,
        `
            Welcome at <b>MariPadel</b>      
            Available commands:
        
            /list - See all coming matches
            /create - Create a padel match
            /join - Join a padel match
            /leave - Leave a padel match you joined
            /update - Update match information: place, time and payment
            /delete - Delete a padel match
        `, {
            parse_mode: 'HTML',
        }
    );
});