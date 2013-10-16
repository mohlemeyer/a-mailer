/*jslint sloppy:true, white:true, plusplus:true */
/*global require */

/**
 * Send emails sequentially over the same TCP connection (Event Bus)
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var vertx = require('vertx');
var container = require('vertx/container');
var console = require('vertx/console');

var emailNo = 0;    // Email counter
var maxEmails = 3;  // Number of email messges to send 

// Set up debugging output
vertx.eventBus.registerHandler('mailerDbgOut', function (msg) {
    console.log('MAILER DEBUG: ' + msg);
});

/*
 * Email producer
 */
function getNextEmail () {
    var result;

    if (emailNo < maxEmails) {
        emailNo++;
        result = {
                from: 'Sender Name' + emailNo + ' <sender.name@domain.com>',
                to: ['Recipient_1 <rec.ipient1@domain1.com>', 'rec.ipient2@domain2.com'],
                cc: 'Recipient_3 <rec.ipient3@domain3.com>',
                subject: 'My Subject ' + emailNo,
                body: 'This is my email body: ' + emailNo
        }; 
    } else {
        result = undefined;
    }

    return result;
} // END: getNextEmail()

/*
 * Send a number of email messages sequentially
 */
function sendNextEmail () {
    var email;
    
    // Retrieve the next E-mail to send here
    email = getNextEmail();
    
    if (email) {
        email.method = 'sendSeq';
        vertx.eventBus.send('mailer', JSON.stringify(email), function (replyJSON) {
            var reply = JSON.parse(replyJSON);

            if (reply.errorMsg) {
                console.log('ERROR SENDING MAIL: ' + reply.errorMsg);
                console.log('\nEXITING...');
                container.exit();
            } else {
                console.log('SERVER RESPONSE: ' + reply.response);
                console.log('FAILED RECIPIENTS: ' + reply.rcptFailedAdrs);
                console.log('');
                
                sendNextEmail('');
            }
        });
    } else {
        vertx.eventBus.send('mailer',
                JSON.stringify({ 'method': 'sendSeqEnd' }),
                function (replyJSON) {
                    var reply = JSON.parse(replyJSON);
        
                    if (reply.errorMsg) {
                        console.log('ERROR ENDING sendSeq: ' + reply.errorMsg);
                    }
        });
        console.log('\nEXITING...');
        container.exit();
    }
} // END: sendNextEmail()

//START
sendNextEmail();
