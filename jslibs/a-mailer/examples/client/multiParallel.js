/*jslint sloppy:true, white:true, vars:true, plusplus: true, unparam: true */
/*global require, Packages */

/**
 * Simple example of sending emails in parallel using multiple smtp clients
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var vertx = require('vertx'); 
var container = require('vertx/container');
var console = require('vertx/console');
var getSmtpClient = require('jslibs/a-mailer/lib/client');

//Adapt these to your environment

//Example: web.de
var MAIL_HOST_NAME = 'smtp.web.de';
var MAIL_HOST_PORT = 25;
var SECURE_CONNECTION = false;

//Example: Gmail
//var MAIL_HOST_NAME = 'smtp.gmail.com';
//var MAIL_HOST_PORT = 465;
//var SECURE_CONNECTION = true;

var AUTH_USER = 'Your_Authentication_User';
var AUTH_PASSWD = 'Your_Authentication_Password';
var SENDER_EMAIL = 'Valid_Sender_EMail_Address';
var SENDER_EMAIL_NAME = 'Sender_EMail_Plaintext_Name';
var RECIPIENT_EMAIL = 'Valid_Recipient_EMail_Address';
var RECIPIENT_EMAIL_NAME = 'Recipient_EMail_Plaintext_Name';

var MSGS_TO_SEND = 5;
var msgsSent = 0;

//=======================================================
//Create the client; immediately connects to the server
//=======================================================
var mailOpts = {
        ignoreTLS: true,
        auth: {
            user: AUTH_USER,
            pass: AUTH_PASSWD
        },
        debug: true
};
if (SECURE_CONNECTION) {
    mailOpts.secureConnection = true;
}

(function sendMail (msgNo) {
    var smtpClient = getSmtpClient(MAIL_HOST_PORT, MAIL_HOST_NAME, mailOpts);

    //=================================
    // Set up debug and error handlers
    //=================================
    smtpClient.on('debug', function (msg) {
        console.log('DEBUG: ' + msg);
    });

    smtpClient.on('rcptFailed', function (failedAddresses) {
        console.log('REJECTED ADDRESSES: ' + failedAddresses);
    });

    smtpClient.on('error', function(error){
        if(error){
            console.log('ERROR: ' + error.toString());
            if (error.name) {console.log('ERROR NAME: ' + error.name);}
            if (error.data) {console.log('ERROR DATA: ' + error.data.toString());}
            if (error.code) {console.log('ERROR CODE: ' + error.code);}
            // "Hard-close" the client without sending "quit" in case of an error
            smtpClient.close();
            container.exit();
        }
    });

    //==============================
    // Set up control flow handlers
    //==============================
    smtpClient.once('idle', function () {
        smtpClient.useEnvelope({
            from: SENDER_EMAIL,
            to: [RECIPIENT_EMAIL]
        });
    });

    smtpClient.on('message', function () {
        smtpClient.write('From: ' + SENDER_EMAIL_NAME + ' <' + SENDER_EMAIL + '>\r\n');
        smtpClient.write('To: ' + RECIPIENT_EMAIL_NAME +' <' + RECIPIENT_EMAIL + '>\r\n');
        smtpClient.write('Subject: Mail No. ' + msgNo + '\n');
        smtpClient.write('\r\n');
        smtpClient.end('This is the message content from mail no. ' + msgNo + '.');
    });

    smtpClient.on('ready', function(success, response) {
        msgsSent++;
        smtpClient.quit();
    });

    smtpClient.on('end', function(success, response) {
        if (msgsSent === MSGS_TO_SEND) {
            container.exit();
        }
    });

    //============================================
    // All handlers set up: Start the next client
    //============================================
    if (msgNo < MSGS_TO_SEND) {
        vertx.setTimer(10, function () {
            sendMail(msgNo + 1);
        });
    }
}(1)); // END: sendmail()