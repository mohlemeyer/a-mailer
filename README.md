# A-Mailer

Vert.x module to send email messages via SMTP asynchronously.

## Module "Types"

This module provides SMTP mailing capabilities on different *levels*:
* As a Vert.x module, callable via the event bus.
* As a CommonJS module, which serves as the JavaScript implementation for the
Vert.x module.
* As a low level SMTP library, which is also implemented as CommonJS module.

## Installation

The easiest way to install the module is to run it:

```
vertx runmod mohlemeyer~a-mailer~{version} 
```

(See the Vert.x [module registry](http://modulereg.vertx.io) for the latest
available release.)

This installs the  module itself plus another module for unit testing.
Afterwards the unit tests will be run.
 
## A-Mailer as a Vert.x Module

In this variation the module is intended to be used as a drop-in
replacement for [mod-mailer](https://github.com/vert-x/mod-mailer). It requires
nearly the same configuration and the API to send an email (hopefully) does not
differ.

Start the module with something like this

```
vertx runmod mohlemeyer~a-mailer~1.0 -conf {path_to_module_config} -cluster
```

### Configuration

The JSON config file might contain the following options

```javascript
{
    "test": <test indicator {boolean}; MUST BE SET TO false, otherwise unit tests will be run; default is true>
    "address": <event bus address {string}>,
    "host": <mail host {string}, optional; default is 'localhost'>,
    "port": <port {integer}, optional; default is 25>
    "ssl": <ssl/tls indicator {boolean}; set to tru to use an encrypted connection; default is false>
    "auth": <authentication indicator {boolean}; set to true if authentication is required; default is false>,
    "username": <authentication user {string}>,
    "password": <authentication password {string}>,
    "content_type": <email body default MIME type: "text/plain" or "text/html" allowed; default is "text/plain">
}
```

#### Difference to `mod-mailer`

The only difference should be in the `test`
property. Set this to `false` in production. Leave the property out, e.g. by
not specifying a config file at all, and the unit tests for the module will be
run.

### Sending an email
 
To send an email, send a JSON message to the event bus address specified in the
configuration above with the following content:

```javascript
{
    "from": <Sender email address in RFC822 format {string}>,
    "to": <Single TO recipient address {string} or a JSON array of addresses>,
    "cc": <Single CC recipient address {string} or a JSON array of addresses>,
    "bcc": <Single BCC recipient address {string} or a JSON array of addresses>,
    "subject": <Email subject {string}>,
    "body": <Email body {string}>,
    "content_type": <email body MIME type; if specified overwrites the MIME type of the configuration>
}
```

On error or after the email has been sent, the mailer responds with a JSON
message on the event bus, which contains the following data:
```javascript
{
    "errorMsg": <If the email could not be delivered, this property contains the error message>,
    "response": <The final server response in case of success>
    "rcptFailedAdrs": <JSON array of email recipient addresses, which were rejected by the server>
}
```

#### Example

A JavaScript usage example of the Vert.x module can be found in
`jslibs/a-mailer/examples/a-mailer/sendMailEB.js`.

#### A Note on Character Encoding
The email subject and body will always be encoded using UTF-8. If you use the
module from JavaScript as a Vert.x module or a CommonJS module and include
non-US characters, make sure to encode the source code file in UTF-8, too.
Otherwise your email content might get mangled.

## A-Mailer as a CommonJS Module

As a JavaScript programmer you can also use A-Mailer as a CommonJS module. In
order for this to work you have to include A-Mailer as a resource in the
`mod.json` module specification of your "using" module. Then, in your
"calling" script, `require` A-Mailer by

```javascript
var mailer = require('jslibs/a-mailer/lib/a-mailer');
```

Note that now you have to configure the module in your code before using it by
calling

```javascript
mailer.configure({
    host: <mail host {string}, optional; default is 'localhost'>,
    port: <port {integer}, optional; default is 25>
    ssl: <ssl/tls indicator {boolean}; set to tru to use an encrypted connection; default is false>
    auth: <authentication indicator {boolean}; set to true if authentication is required; default is false>,
    username: <authentication user {string}>,
    password: <authentication password {string}>,
    content_type: <email body default MIME type: "text/plain" or "text/html" allowed; default is "text/plain">
});
```

Do not configure an event bus address in this case!

Mail can then be sent by calling the `send` method:

```javascript
function replyHandler (err, reply) {
    if (err) {
        // Handle error
        ...
    } else {
        // Handle success
        // "reply" contains a "response" property with the
        // last server response and optionally a "rcptFailedAdrs"
        // property with an array of email addresses which were
        // rejected by the server.
        ...
    }
}

mailer.send(message, replyHandler);
```

`message` is a JavaScript object in analogy to the JSON message object in case
of the use as a Vert.x module. More information might be obtained from the
JSDoc documentation under `jslibs/a-mailer/jsDocOut`.

#### Example

A usage example of the CommonJS module can be found in
`jslibs/a-mailer/examples/a-mailer/sendMailCommonJS.js`.

## Simple SMTP Client

The SMTP library in `jslibs/a-mailer/lib/client.js` implements a raw
async SMTP client as a CommonJS module. The module exposes a factory method
to retrieve a new client:
```javascript
var getSmtpClient = require('jslibs/a-mailer/lib/client');
```

### Credits
The `client.js` library is derived from the file of the same name
in the node.js [simplesmtp](https://github.com/andris9/simplesmtp) library. All
the hard work has been done by the author of the node module. The effort here
is simply a port to the Vert.x platform (including this documentation). 

### Usage

A new SMTP client can be created with
```javascript
var smtpClient = getSmtpClient(port[,host][, options]);
```

where

  * **port** is the port to connect to
  * **host** is the hostname to connect to (defaults to "localhost")
  * **options** is an optional options object (see below)

### Connection options

The following connection options can be used with `getSmtpClient`:

  * **secureConnection** - use SSL for the initial connection
  * **name** - the name of the smtp server to connect to
  * **auth** - authentication object `{user:"...", pass:"..."}`
  * **ignoreTLS** - ignore server support for STARTTLS; currently this must be explicitly set to `true` because STARTTLS is not yet supported on Vert.x
  * **debug** - emit `debug` events for tracing the communication between client and server
  * **instanceId** - unique instance id for debugging (will be logged with the messages)
  * **greetingTimeout** (defaults to 10000) - Time to wait in ms until greeting message is received from the server
  * **connectionTimeout** Time to wait in ms until the socket is opened to the server

### Connection events

Once a connection is set up the following events can be listened to:

  * **'idle'** - the connection to the SMTP server has been successfully set up and the client is waiting for an envelope
  * **'message'** - the envelope is passed successfully to the server and a message stream can be started
  * **'ready'** `(success)` - the message was sent
  * **'rcptFailed'** `(addresses)` - not all recipients were accepted (invalid addresses are included as an array)
  * **'error'** `(err)` - An error occurred. The connection is closed and an 'end' event is emitted shortly
  * **'end'** - connection to the client is closed
  * **'debug'** `(msg)` - debug message as a string

### Sending an envelope

When an `'idle'` event is emitted, an envelope object can be sent to the server.
This includes a string `from` and an array of strings `to` property.

Envelope can be sent with `smtpClient.useEnvelope(envelope)`

```javascript
    // run only once when a single email should be sent as 'idle'
    // is emitted again after message delivery
    smtpClient.once("idle", function(){
        smtpClient.useEnvelope({
            from: "me@example.com",
            to: ["receiver1@example.com", "receiver2@example.com"]
        });
    });
```

The `to` part of the envelope includes **all** recipients from `To:`, `Cc:` and `Bcc:` fields.

If setting the envelope up fails, an error is emitted. If only some (not all)
recipients are not accepted, the mail can still be sent but an `rcptFailed`
event is emitted.

```javascript
    smtpClient.on("rcptFailed", function(addresses){
        console.log("The following addresses were rejected: ", addresses);
    });
```

If the envelope is set up correctly a `'message'` event is emitted.

### Sending a message

When the `'message'` event is emitted, it is possible to send mail. To do this
you can *pump* a message source (for example an .eml file) directly to the client
or alternatively you can send the message with multiple `smtpClient.write` calls.
You also need to call `smtpClient.end()` once the message is completed.

If you are pumping a stream to the client, do not leave the `smtpClient.end()` call
out; this is needed to complete the message sequence by the client.
```javascript
    smtpClient.on("message", function(){
        vertx.fileSystem.open('test.eml',
                vertx.fileSystem.OPEN_READ, function(openErr, asyncFile) {
            if (!openErr) {
                asyncFile.endHandler(function() {
                    asyncFile.close();
                    smtpClient.end();
                });
                new vertx.Pump(asyncFile, smtpClient).start();
            }
        });
    });
```

Once the message is delivered a `'ready'` event is emitted. The event has an
parameter which indicates if the message was transmitted( (true) or not (false)
and another which includes the last received data from the server.
```javascript
    smtpClient.on("ready", function(success, response){
        if(success){
            console.log("The message was transmitted successfully with " + response);
        }
    });
```

### Error types

Emitted errors (often, but not always) include the reason for failing in the
`name` property. Some possible values are:

  * **UnknowAuthError** - the client tried to authenticate but the method was not supported
  * **AuthError** - the username/password used were rejected
  * **TLSError** - STARTTLS failed
  * **SenderError** - the sender e-mail address was rejected
  * **RecipientError** - all recipients were rejected (if only some of the recipients are rejected, a `'rcptFailed'` event is raised instead

Sometimes there is also an additional property in the error object called
`data` which includes the last response received from the server
(if available for the current error type).

When an `error` event is emitted, the underlying connection is closed. 

### About reusing the connection

You can reuse the same connection several times but you can't send several mails
through the same connection concurrently. So if you catch an `'idle'` event
lock the connection for the respective message process and unlock after `'ready'`.

On `'error'` events you should reschedule the message and on `'end'` events
you should recreate the connection.

### Closing the client

By default the client tries to keep the connection open. If you want to close it,
run `smtpClient.quit()` - this sends a `QUIT` command to the server and closes the
connection
```javascript
    smtpClient.quit();
```

### Examples

Comprehensive examples can be found in `jslibs/a-mailer/examples/client`.

## Limitations

Compared to the original node.js code the Vert.x module has a few notable
shortcomings:
* **No STARTTLS support**: This is probably the most severe omission. Due to the
fact that Vert.x currenty does not provide a way to *upgrade* an existing
unsecured tcp connection to a TLS connection I did not find a way to implement
STARTTLS support. This means that, unless the communication already starts
encrypted (as is the case with GMail on port 465), all communication between
client and server is performed as clear text.
* **No XOauth (2) support**
* **No support for CRAM-MD5 authentication**

## License

**MIT**