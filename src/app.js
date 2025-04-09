require('dotenv').config();
const https = require('https');
const fs = require('fs');
const fsPromises = fs.promises;
const fileName = './padelMatches.json';
const historyFileName = './historyPadelMatches.csv';
const padelMatch = require('./padelMatch');
const TelegramBot = require('node-telegram-bot-api');
const token = process.env.TOKEN;

const dateOptions = {weekday: 'short', month: 'short', day: 'numeric'};
const timeOptions = {hour: '2-digit', minute: '2-digit', hour12: false};

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
    // Group by past and future datetime
    const result = Object.groupBy(matches, ({ dateTime }) =>
        isFutureDate(dateTime) ? "future" : "past",
    );

    // // Clear old matches
    // matches = await matches.filter((m) => {
    //     return isFutureDate(m.dateTime); 
    // });
    await fsPromises.writeFile(fileName, JSON.stringify(result.future))
        .catch((err) => {
            bot.sendMessage(
                chatId,
                '❌ Error! Match not saved',
            );
        });

    try {
        let history = "";

        for (m of result.past){
            const dateTime = new Date(m.dateTime);
            history += `\nPàdel del Ram,${twoDigits(dateTime.getDate())}/${twoDigits(dateTime.getMonth()+1)}/${dateTime.getFullYear()},4,Partit de pàdel,${m.place},Organitzador: ${m.owner.first_name}`;
        }

        console.log(history);

        fsPromises.appendFile(historyFileName, history)
            .catch((err) => {
                bot.sendMessage(
                    chatId,
                    '❌ Error! History not saved',
                );
            });
    }
    catch(err) {
        console.log(err);
    }
}

const validateDate = (string) => {
    let valid = true;
    var re = new RegExp(/([0-9]|[12][0-9]|3[01])\/([0-9]{2})\/([0-9]{2})/gm);
    if (!re.test(string))
        valid = false;
    return valid;
}

// Check if date is today or later in the future
const isFutureDate = (date, object = true) => {
    if(object)
        newDate = new Date(date);
    else {
        d = date.split('/');
        newDate = new Date('20'+d[2], d[1]-1, d[0]);
    }
    return new Date(newDate.toDateString()) >= new Date(new Date().toDateString());
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
    
    await padelMatches.forEach(async (m, i) => {
        const dateTime = new Date(m.dateTime);
        matchesText += `<blockquote>`;
        matchesText += `<b>Match #${i+1}</b>\n📅 <i>Date:</i> <b>${dateTime.toLocaleDateString("en-US", dateOptions)}</b>\n⏰ <i>Time:</i> <b>${dateTime.toLocaleTimeString("en-US", timeOptions)}</b>\n📍 <i>Place:</i> <b>${m.place}</b>`;
        // Retrieve players
        if(m.players.length){
            matchesText += `\n<i>Players:</i>\n`;
            for (const p of m.players) {
                matchesText += `🎾 <b><a href="https://t.me/${p.username}">${p.first_name}</a></b>\n`;
            }
        }
        matchesText += `</blockquote>`;
    });
    return matchesText;
}

const createMatchesKeyboard = async (action) => {
    let keyboard = [];

    padelMatches.forEach((m, i) => {
        const dateTime = new Date(m.dateTime);
        const formattedDate = dateTime.toLocaleDateString("en-US", dateOptions);
        const formattedTime = dateTime.toLocaleTimeString("en-US", timeOptions);

        // Add buttons to the keyboard
        keyboard.push([{
            text: `🏓 #${i+1} ${formattedDate} ${formattedTime} | 📍 ${m.place}`,
            callback_data: JSON.stringify({ action: action, matchId: String(m.id) }),
        }]);
    });

    // Return the custom keyboard
    return {
        reply_markup: JSON.stringify({
            inline_keyboard: keyboard,
            resize_keyboard: true,
            one_time_keyboard: true,
        }),
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
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
                            bot.sendMessage(chatId, "Match place? Write \"TBC\" (to be confirmed) if still unknown").then(function () {
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
                                            '✅ Match has been successfully created!',
                                        ));
                                }
                            });
                        }
                        else
                            bot.sendMessage(chatId, "❌ Invalid time!");
                    }
                });
            else
                bot.sendMessage(chatId, "❌ Invalid date!");
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
    bot.sendMessage(chatId, matchesInfo, {parse_mode: 'HTML', disable_web_page_preview: true});
});

bot.onText(/\/update/, async (msg, match) => {
    await loadMatches();
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();

    if(!matchesInfo.length)
        return noMatches();

    keyboard = await createMatchesKeyboard('update');

    bot.sendMessage(
        chatId,
        'Which match do you want to <b>update</b>?\n\n' + matchesInfo,
        keyboard
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
                                            '✅ Match has been successfully updated!',
                                        ));
                                }
                            });
                        }
                        else
                            bot.sendMessage(chatId, "⚠️ Invalid time!");
                    }
                });
            else
                bot.sendMessage(chatId, "⚠️ Invalid date!");
        }
    });
};    

bot.onText(/\/join/, async (msg, match) => {
    await loadMatches();
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();

    if(!matchesInfo.length)
        return noMatches();

    keyboard = await createMatchesKeyboard('join');

    bot.sendMessage(
        chatId,
        'Which match do you want to <b>join</b>?\n\n' + matchesInfo,
        keyboard
    );
});

const joinMatch = async (cb, matchId) => {
    const chatId = cb.message.chat.id;
    await loadMatches();

    const index = await padelMatches.findIndex((m) => m.id == matchId);
   
    // Check match date
    if(!isFutureDate(padelMatches[index].dateTime))
        return bot.sendMessage(chatId, "⚠️ Sorry this match was already played");

    // Check number of players
    if(padelMatches[index].players.length >= 4)
        return bot.sendMessage(chatId, "⚠️ Match is full!");

    // Check player is not already enrolled
    if(padelMatches[index].players.length) {
        let valid = await padelMatches[index].players.every((p) => {
            return p.id != cb.from.id;
        });
        if(!valid)
            return bot.sendMessage(chatId, "⚠️ You are already enrolled!");
    }

    // Add player
    padelMatches[index].players.push(cb.from);
    storeMatches(padelMatches)
        .then(() => bot.sendMessage(
            chatId,
            '✅ You joined the match successfully!',
        ));
};

bot.onText(/\/leave/, async (msg, match) => {
    await loadMatches();
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();

    if(!matchesInfo.length)
        return noMatches();

    keyboard = await createMatchesKeyboard('leave');

    bot.sendMessage(
        chatId,
        'Which match do you want to <b>leave</b>?\n\n' + matchesInfo,
        keyboard
    );
});

const leaveMatch = async (cb, matchId) => {
    const chatId = cb.message.chat.id;
    await loadMatches();
    const index = await padelMatches.findIndex((m) => m.id == matchId);
   
    // Check number of players
    if(!padelMatches[index].players.length)
        return bot.sendMessage(chatId, "❌ There are no players");
    
    let valid = await padelMatches[index].players.find((p) => p.id == cb.from.id);

    if(valid == undefined)
        return bot.sendMessage(chatId, "❌ You are not enrolled on this match!");

    let filteredPlayers = await padelMatches[index].players.filter((p) => {
        return p.id != cb.from.id;
    });

    // Add player
    padelMatches[index].players = filteredPlayers;
    storeMatches(padelMatches)
        .then(() => bot.sendMessage(
            chatId,
            '✅ You left the match',
        ));
};

bot.onText(/\/delete/, async (msg, match) => {
    await loadMatches(msg.from.id);
    chatId = msg.chat.id;
    matchesInfo = await getMatchesInfo();

    if(!matchesInfo.length)
        return noMatches();

    keyboard = await createMatchesKeyboard('delete');

    bot.sendMessage(
        chatId,
        'Which match do you want to <b>delete</b>? <em>Only matches you own</em>\n\n' + matchesInfo,
        keyboard
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
            '✅ Match deleted',
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
            bot.sendMessage(chatId, "❌ Action not recognized");
    }
});

const twoDigits = (string) => {
    return ("0" + string).slice(-2);
}

const noMatches = () => {
    bot.sendMessage(chatId, '❌ There are no matches', {parse_mode: 'HTML'});
}

// Next 5 days forcast. Source Accuweather API.
bot.onText(/\/forecast/, async (msg) => {
    const accuweatherApiKey = process.env.ACCUWEATHER_API_KEY;
    const accuweather5Days = 'https://dataservice.accuweather.com/forecasts/v1/daily/5day/307297?apikey=' + accuweatherApiKey + '&language=en-US&details=true&metric=true';
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

    chatId = msg.chat.id;
    let message;

    try {
        const res = await fetch(accuweather5Days);
        const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';
        const forecast = await res.json();

        message = '<b>BARCELONA 5 DAYS FORECAST</>\n'; 
        for(dayForecast of forecast.DailyForecasts){
            let d = new Date(dayForecast.Date);
            message += `<blockquote><b>${dayNames[d.getDay()]}</b>\n`;
            message += `${getWeatherIcon(dayForecast.Day.Icon)} <b>${dayForecast.Day.IconPhrase}</b>\n`;
            message += `<i>Min.</i> ${dayForecast.Temperature.Minimum.Value}°C <i>Max.</i> ${dayForecast.Temperature.Minimum.Value}°C\n`;
            message += `<i>Rain Prob.</i> ${dayForecast.Day.RainProbability}%\n`;
            message += `<i>Wind</i> ${dayForecast.Day.Wind.Speed.Value} ${dayForecast.Day.Wind.Speed.Unit} \(<i>Max.</i> ${dayForecast.Day.WindGust.Speed.Value}\)</blockquote>\n`;
        }
        message += `More info <a href="${forecast.Headline.MobileLink}">here</a>`;
    }
    catch(err) {
        bot.sendMessage(chatId, '❌ Error: ' + err.message, {parse_mode: 'HTML'});
    }

    bot.sendMessage(
        chatId,
        message,
        {parse_mode: 'HTML', disable_web_page_preview: true}
    );
});

// Retrieve matches history data 
bot.onText(/\/history/, async (msg) => {
    try {
        bot.sendDocument(msg.chat.id, historyFileName); 
    }
    catch(err) {
        bot.sendMessage(chatId, 'Error: ' + err.message, {parse_mode: 'HTML'});
    }
});

const getWeatherIcon = (icon) => {
    switch(icon){
        case 1: return "☀"; // sun
        case 2: return "🌤"; // sun behind small cloud
        case 3:
        case 4: 
        case 5: 
        case 6: return "🌥"; //sun behind large cloud
        case 7:
        case 8: return "☁"; //cloud
        case 11: return "🌫"; // fog
        case 12: return "🌧"; // cloud with rain
        case 13:
        case 14: return "🌦"; // sun behind rain cloud
        case 15: return "🌩"; // cloud with lightning
        case 16: 
        case 17: return "🌧"; // cloud with rain
        case 18: return "🌧"; // cloud with rain
        case 19: return "☁"; //cloud
        case 20: return "🌥"; //sun behind large cloud
        case 21: return "🌤"; // sun behind small cloud
        case 22: return "☁"; //cloud
        case 23: return "🌥"; //sun behind large cloud
        case 24: return "❄"; // snowflake
        case 25:
        case 26:
        case 29: return "🌨"; // cloud with snow
        case 32: return "🌬"; // windy
        default: return;
    }
}

// Listener (handler) for telegram's /start event
// This event happened when you start the conversation with both by the very first time
// Provide the list of available commands
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
        chatId,
`
<b>Welcome to Pádel del Ram</b> 🎾

<i>Available commands:</i>

➡️ <b>/list</b> - See all upcoming matches
➡️ <b>/create</b> - Create a new padel match
➡️ <b>/join</b> - Join a padel match
➡️ <b>/leave</b> - Leave a padel match you joined
➡️ <b>/update</b> - Update match information: place, time, and payment
➡️ <b>/forecast</b> - View the weather forecast for the next 5 days
➡️ <b>/delete</b> - Delete a padel match

<i>Enjoy the game!</i>
`
        , {
            parse_mode: 'HTML',
        }
    );
});