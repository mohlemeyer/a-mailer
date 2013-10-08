/*jslint sloppy:true, white:true */
/*global require */

/**
 * Simple usage of A-Mailer as a Vert.x module
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var vertx = require('vertx');
var container = require('vertx/container');
var console = require('vertx/console');

var email = {
        from: 'Sender Name <sender.name@domain.com>',
        to: ['Recipient_1 <rec.ipient1@domain1.com>', 'rec.ipient2@domain2.com'],
        cc: 'Recipient_3 <rec.ipient3@domain3.com>',
        subject: 'My Subject',
        body: 'This is my email body.'
};

vertx.eventBus.send('mailSender', JSON.stringify(email), function (replyJSON) {
    var reply = JSON.parse(replyJSON);

    if (reply.errorMsg) {
        console.log('ERROR SENDING MAIL: ' + reply.errorMsg);
    } else {
        console.log('SERVER RESPONSE: ' + reply.response);
        console.log('FAILED RECIPIENTS: ' + reply.rcptFailedAdrs);
    }
    console.log('\nEXITING...');
    container.exit();
});