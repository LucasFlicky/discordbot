/**
 * Created by julian on 15.05.2016.
 */
var config = require('./config/main.json');
var winston = require('winston');
var prefix = "!w.";
winston.info(`Starting Init of Bot!`);
winston.add(winston.transports.File, {filename: `logs/rem-main.log`});
var logger = require('./utility/logger');
logger.setT(winston);
var raven = require('raven');
var errorReporter = require('./helper/utility/errorReporter');
var client = new raven.Client(config.sentry_token);
errorReporter.setT(client);
winston.info('Starting Errorhandling!');
if (!config.beta) {
    client.patchGlobal(() => {
        winston.error('Oh no I died!');
        process.exit(1);
    });
}
if (!config.beta) {
    var StatsD = require('node-dogstatsd').StatsD;
    var dogstatsd = new StatsD();
}
var i18next = require('i18next');
var i18nBean = require('./utility/i18nManager');
var Backend = require('i18next-node-fs-backend');
var backendOptions = {
    loadPath: 'locales/{{lng}}/{{ns}}.json',
    addPath: 'locales/{{lng}}/{{ns}}.missing.json',
    jsonIndent: 2
};
i18next.use(Backend).init({
    whitelist: ['en', 'de'],
    backend: backendOptions,
    lng: 'en',
    fallbackLng: false,
    preload: ['de', 'en']
}, (err, t) => {
    if (err) {
        client.captureMessage(err);
        return winston.error('Error at i18n' + err);
    }
    i18nBean.setT(t);
    var Discord = require("discord.js");
    var options = {
        protocol_version: 6,
        max_message_cache: 1500
    };
    winston.info(options);
    var bot = new Discord.Client(options);
    var request = require('request');
    var CMD = require('./helper/cmdManager');
    var mongoose = require('mongoose');
    var socket = require('socket.io-client')('http://127.0.0.1:7004/bot');
    var socketManager = require('./helper/socket/basic');
    var messageHelper = require('./utility/message');
    var voice = require('./utility/voice');
    var async = require('async');
    winston.info('Connecting to DB');
    mongoose.connect('mongodb://localhost/discordbot', (err) => {
        if (err) {
            client.captureMessage(err);
            return winston.error("Unable to connect to Mongo Server!");
        }
    });
    winston.info('Logging in...');
    bot.login(config.token).then(winston.info('Logged in successfully'));
    socketManager.init(socket);
    winston.info('Bot finished Init');
    bot.on('ready', () => {
        bot.user.setStatus('online', `!w.help | bot.ram.moe`).then().catch(winston.info);
        CMD.init();
        setTimeout(() => {
            winston.info('start loading Voice!');
            async.eachLimit(bot.guilds.array(),1, (guild, cb) => {
                voice.loadVoice(guild).then(id => {
                    if (err) return cb(err);
                    if (typeof (id) !== 'undefined' && id !== '') {
                        winston.info('started joining guild:' + guild.name);
                        var channel = voice.getChannelById(guild, id);
                        if (typeof (channel) !== 'undefined' && channel) {
                            channel.join().then(connection => {
                                var message = {guild: guild};
                                voice.autoStartQueue(message);
                                cb();
                            }).catch(cb);
                        }
                    } else {
                        async.setImmediate(() => {
                            cb();
                        });
                    }
                }).catch(console.log);
            }, (err) => {
                if (err) {
                    return winston.error(err);
                }
                winston.info('Finished Loading Voice!');
            });
        }, 10000);
        if (!config.beta) {
            updateStats();
            dogstatsd.gauge('musicbot.guilds', bot.guilds.size);
            dogstatsd.gauge('musicbot.users', users());
        }
        if (!config.beta) {
            setInterval(() => {
                dogstatsd.gauge('musicbot.guilds', bot.guilds.size);
                dogstatsd.gauge('musicbot.users', users());
            }, 1000 * 30);
        }
        setInterval(() => {
            updateStats();
        }, 1000 * 60 * 60 * 3);
    });
    bot.on('reconnecting', () => {
        // winston.info('Reconnecting to Discord!');
    });
    bot.on("message", (message) => {
        if (!message.guild || config.beta && message.guild.id !== '110373943822540800' || !config.beta) {
            if (!config.beta) {
                dogstatsd.increment('musicbot.messages');
            }
            if (!config.beta) {
                dogstatsd.increment('musicbot.commands');
            }
            message.botUser = bot;
            CMD.checkCommand(message);
        }
        // } else if (message.guild && !message.mentions.users.exists('id', bot.user.id) && !message.author.equals(bot.user) && message.guild.id !== '110373943822540800' && !message.author.bot) {
        //     messageHelper.updateXP(message, (err) => {
        //         if (err) return winston.error(err);
        //     });
        // }
        // if (message.guild && !!message.mentions.users.get(bot.user.id) && message.guild.id !== '110373943822540800') {
        //     if (!config.beta) {
        //         dogstatsd.increment('musicbot.cleverbot');
        //     }
        //     CMD.cleverbot.talk(message);
        // }

    });
    // bot.on('guildMemberAdd', (Guild, member) => {
    //     Guild.defaultChannel.sendMessage(`Welcome ${member.user} on **${Guild.name}**`);
    // });
    // bot.on('guildMemberRemove', (Guild, member) => {
    //     Guild.defaultChannel.sendMessage(`**${member.user.username}** just left us`);
    // });
    bot.on("debug", winston.info);
    bot.on("warn", winston.info);
    bot.on('error', (error) => {
        client.captureMessage(error);
        winston.error(error);
    });
    var updateStats = function () {
        let id;
        if (config.beta) {
            id = config.client_id
        } else {
            id = config.bot_id
        }
        let requestOptions = {
            headers: {
                Authorization: config.discord_bots_token
            },
            url: `https://bots.discord.pw/api/bots/${id}/stats`,
            method: 'POST',
            json: {
                "server_count": bot.guilds.size
            }
        };
        request(requestOptions, function (err, response, body) {
            if (err) {
                client.captureMessage(err);
                return winston.error(err);
            }
            winston.info('Stats Updated!');
            winston.info(body);
        });
    };
    var users = function () {
        let users = 0;
        bot.guilds.map((guild => {
            if (guild.id !== '110373943822540800') {
                users = users + guild.members.size;
            }
        }));
        return users;
    };
});

// "shard_id":process.argv[2],
// "shard_count":config.shards