/*jslint sloppy:true, white:true, plusplus:true */
/*global require */

/**
 * Send emails sequentially over the same TCP connection (CommonJS)
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var console = require('vertx/console');
var container = require('vertx/container');
var aMailer = require('jslibs/a-mailer/lib/a-mailer');

var mailer = aMailer.getMailer({
    host: 'your_mail_host',
    port: 'mail_host_port',
    debug: true
        // and maybe more configuration options. See docs.
});

mailer.on('debug', function (msg) {
    console.log('DEBUG: ' + msg);
});

var emailNo = 0;    // Email counter
var maxEmails = 3;  // Number of email messges to send 

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
        mailer.sendSeq(email, function (err, result) {
            if (err) {
                console.log('ERROR SENDING MAIL: ' + err.toString());
                console.log('\nEXITING...');
                container.exit();
            } else {
                console.log('SERVER RESPONSE: ' + result.response);
                console.log('FAILED RECIPIENTS: ' + result.rcptFailedAdrs);
                console.log('');
                
                sendNextEmail();
            }
        });
    } else {
        mailer.sendSeqEnd();
        console.log('\nEXITING...');
        container.exit();
    }
} // END: sendNextEmail()

// START
sendNextEmail();
