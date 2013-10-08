/*jslint sloppy:true, white:true, vars:true */
/*global require, Packages */

/**
 * Minimal but comprehensive SMTP example
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

//Data source constants
var DATA_SOURCE_DIRECT_WRITE = 1;
var DATA_SOURCE_FILE         = 2;
var DATA_SOURCE_JAVAX_MAIL   = 3;

//Choose a variant for email message composition; see the message handler
var EMAIL_DATA_SOURCE = DATA_SOURCE_DIRECT_WRITE;

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

var smtpClient = getSmtpClient(MAIL_HOST_PORT, MAIL_HOST_NAME, mailOpts);

//=================================
//Set up debug and error handlers
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
    }
    // "Hard-close" the client without sending "quit" in case of an error
    smtpClient.close();
    container.exit();
});

//==============================
//Set up control flow handlers
//==============================
smtpClient.once('idle', function () {
    smtpClient.useEnvelope({
        from: SENDER_EMAIL,
        to: [RECIPIENT_EMAIL]
    });
});

//The message handler demonstrates three different variants to compose the
//content (header, body) of an email message.
smtpClient.on('message', function () {
    var message;
    var outStream;
    
    if (EMAIL_DATA_SOURCE === DATA_SOURCE_DIRECT_WRITE) {
        // 1st Variant:
        // The message content is constructed on the fly and written in chunks
        // to the receiving server. The last chunk is written with the
        // "end()" instead of the "write()" method.
        smtpClient.write('From: ' + SENDER_EMAIL_NAME + ' <' + SENDER_EMAIL + '>\r\n');
        smtpClient.write('To: ' + RECIPIENT_EMAIL_NAME +' <' + RECIPIENT_EMAIL + '>\r\n');
        smtpClient.write('Subject: Mail Subject (DIRECT WRITE)\n');
        smtpClient.write('\r\n');
        smtpClient.end('This is the message content (DIRECT WRITE).');

    } else if (EMAIL_DATA_SOURCE === DATA_SOURCE_FILE) {
        // 2nd Variant:
        // The message is streamed from a ReadStream to the smtp client, which
        // implements the WriteStream interface. In this case the email message
        // is read from a file in the filesystem.
        //
        // Adapt the file contents to match your environment!
        vertx.fileSystem.open('./jslibs/a-mailer/examples/client/msg.txt',
                vertx.fileSystem.OPEN_READ, function(openErr, asyncFile) {
            if (!openErr) {
                asyncFile.endHandler(function() {
                    asyncFile.close();
                    smtpClient.end();
                });
                new vertx.Pump(asyncFile, smtpClient).start();
            } else {
                console.log('ERROR OPENING FILE TO STREAM: ' + openErr);
            }
        });

    } else if (EMAIL_DATA_SOURCE === DATA_SOURCE_JAVAX_MAIL) {
        // 3rd Variant:
        // The message content is composed by using methods of the javax.mail
        // package. The finalized message is intermediately written to a
        // ByteArrayOutputStream, which is then sent to the server after being
        // transformed to a ByteArray.
        message = new Packages.javax.mail.internet.MimeMessage(Packages.javax.mail.Session.getInstance(Packages.java.lang.System.getProperties()));
        message.setFrom(new Packages.javax.mail.internet.InternetAddress(SENDER_EMAIL, SENDER_EMAIL_NAME));
        message.setRecipients(Packages.javax.mail.Message.RecipientType.TO, [new Packages.javax.mail.internet.InternetAddress(RECIPIENT_EMAIL, RECIPIENT_EMAIL_NAME)] );
        message.setSubject('Mail Subject (JAVAX MAIL)');
        message.setText('This is the message content (JAVAX MAIL).');
        outStream = new Packages.java.io.ByteArrayOutputStream();
        message.writeTo(outStream);
        smtpClient.end(new vertx.Buffer(outStream.toByteArray()));
    }
});

smtpClient.on('ready', function(success, response) {
    if (!success) {
        console.log('MAIL TRANSFER NOT SUCCESSFUL. MESSAGE FROM SERVER: ' +
                response);
    }
    smtpClient.quit();
});

smtpClient.on('end', function() {
    container.exit();
});