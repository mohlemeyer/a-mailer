/**
 * QUnit tests for a-mailer
 * 
 * @author Matthias Ohlemeyer (mohlemeyer@gmail.com)
 * @license MIT
 *
 * Copyright (c) 2013 Matthias Ohlemeyer
 */
var getSmtpClient = require('jslibs/a-mailer/lib/client');

//==========================================================================
QUnit.module('a-mailer.smtpClient', {
//	========================================================================
	setup: function () {
		var self = this;

		// Stub the vertx.createNetClient method with a function which returns
		// a fake net client.
		sinon.stub(vertx, "createNetClient", function () {

			// The fake net client is available in the scope of the setup
			// function and thereby in the scope of the test functions. It
			// provides a spied "connect" method, which calls its callback
			// with a fake client socket.
			self.fakeNetClient = {
					connect: sinon.spy(function (port, host, callback) {

						// The fake client socket is also available in the scope
						// of the test functions. It provides empty handlers and
						// spied write method. Only the method to set up a
						// dataHandler is currently set up for further
						// investigation.
						self.fakeClientSocket = {
								exceptionHandler: function () {},

								// The method to set up a dataHandler is
								// provided by a function, which sets up a
								// fake smtp server in the scope of the test
								// functions. Then "send" method of the fake
								// server converts its string data argument
								// into a vertx buffer and calls the 
								// data handler callback with this data.
								// (We know that internally the "_onData"
								// method of the smpt client gets called.)
								dataHandler: function (dataCb) {
									self.fakeSmtpServer = {
											send : function (data) {
												dataCb(new vertx.Buffer(data));
											}};
								},
								closeHandler: function () {},
								endHandler: function () {},
								write: sinon.spy()
						};
						// Simulate a successful "connect" and call
						// the callback with the fake client socket
						callback(undefined, self.fakeClientSocket);
					})
			};

			return self.fakeNetClient;
		});
	},

	teardown: function () {
		vertx.createNetClient.restore();
	}
});

asyncTest('Should create net client', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';

	var smtpClient = getSmtpClient(port, host);

	vertx.setTimer(100, function () {
		ok(vertx.createNetClient.calledOnce, 'Vert.x net client created');
		ok(self.fakeNetClient.connect.calledOnce, 'connect called on net client');

		self.fakeSmtpServer.send('220 Service ready\n');
		start();
	});
});

asyncTest('Should call "connect" on net client', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';

	var smtpClient = getSmtpClient(port, host);

	vertx.setTimer(100, function () {
		equal(port, self.fakeNetClient.connect.firstCall.args[0], 'connect called with port');
		equal(host, self.fakeNetClient.connect.firstCall.args[1], 'connect called with host');
		equal('function', typeof self.fakeNetClient.connect.firstCall.args[2], 'connect called with callback');

		self.fakeSmtpServer.send('220 Service ready\n');
		start();
	});
});

asyncTest('Should send "EHLO" to server after Service is ready', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';
	var clientName = 'myClient';

	var smtpClient = getSmtpClient(port, host, {
		name: clientName
	});

	vertx.setTimer(100, function () {
		self.fakeSmtpServer.send('220 Service ready\r\n');

		equal(self.fakeClientSocket.write.lastCall.args[0].toString('utf-8'), 'EHLO ' + clientName + '\r\n', 'EHLO sent to server');
		start();
	});
});

asyncTest('Should call error callback after greeting timeout', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';
	var clientName = 'myClient';
	var errorCallback = sinon.spy();

	var smtpClient = getSmtpClient(port, host, {
		name: clientName,
		greetingTimeout: 100
	});

	smtpClient.on('error', errorCallback);

	ok(!errorCallback.called, 'Error callback initially not called');
	vertx.setTimer(200, function () {
		ok(errorCallback.called, 'Error called after greeting timeout');
		equal(errorCallback.lastCall.args[0].code, 'ETIMEDOUT', 'Error code is ETIMEDOUT');
		start();
	});
});

asyncTest('Should send authentication data to server', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';
	var clientName = 'myClient';

	var smtpClient = getSmtpClient(port, host, {
		name: clientName,
		ignoreTLS: true,
		auth: {
			user: 'myUser',
			pass: 'myPasswd'
		},
		debug: false
	});

	smtpClient.on('debug', function (msg) {
		console.log(msg);
	});

	vertx.setTimer(100, function () {
		self.fakeSmtpServer.send('220 Service ready\r\n');
		self.fakeSmtpServer.send('250-Hello\r\n');
		self.fakeSmtpServer.send('250AUTH LOGIN PLAIN\r\n');

		equal(self.fakeClientSocket.write.lastCall.args[0].toString('utf-8').indexOf('AUTH PLAIN'), 0, 'Authentication sent to server');
		start();
	});
});

asyncTest('Should emit "idle" event after authentication is completed', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';
	var clientName = 'myClient';
	var idleCallback = sinon.spy();

	var smtpClient = getSmtpClient(port, host, {
		name: clientName,
		ignoreTLS: true,
		auth: {
			user: 'myUser',
			pass: 'myPasswd'
		},
		debug: false
	});

	smtpClient.on('debug', function (msg) {
		console.log(msg);
	});

	smtpClient.once('idle', idleCallback);

	vertx.setTimer(100, function () {
		self.fakeSmtpServer.send('220 Service ready\r\n');
		self.fakeSmtpServer.send('250-Hello\r\n');
		self.fakeSmtpServer.send('250 AUTH LOGIN PLAIN\r\n');

		ok(!idleCallback.called, 'idle callback not called before server response');
		self.fakeSmtpServer.send('235 Authentication succeeded\r\n');
		ok(idleCallback.called, 'idle callback called after server response');
		start();
	});
});

asyncTest('Should send "MAIL FROM" and "RCPT TO" as envelope', 2, function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';
	var clientName = 'myClient';

	var smtpClient = getSmtpClient(port, host, {
		name: clientName,
		ignoreTLS: true,
		auth: {
			user: 'myUser',
			pass: 'myPasswd'
		},
		debug: false
	});

	smtpClient.on('debug', function (msg) {
		console.log(msg);
	});

	smtpClient.once('idle', function () {
		smtpClient.useEnvelope({
			from: "matthias.ohlemeyer@web.de",
			to: ["mohlemeyer@gmail.com"]
		});

		equal(self.fakeClientSocket.write.lastCall.args[0].toString('utf-8').indexOf('MAIL FROM:<'), 0, 'MAIL FROM sent to server');
		self.fakeSmtpServer.send('250 Requested mail action okay, completed\r\n');
		equal(self.fakeClientSocket.write.lastCall.args[0].toString('utf-8').indexOf('RCPT TO:<'), 0, 'RCPT TO: sent to server');		
		start();
	});

	vertx.setTimer(100, function () {
		self.fakeSmtpServer.send('220 Service ready\r\n');
		self.fakeSmtpServer.send('250-Hello\r\n');
		self.fakeSmtpServer.send('250 AUTH LOGIN PLAIN\r\n');
		self.fakeSmtpServer.send('235 Authentication succeeded\r\n');
	});
});

asyncTest('Should send "DATA" command to the server', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';
	var clientName = 'myClient';

	var smtpClient = getSmtpClient(port, host, {
		name: clientName,
		ignoreTLS: true,
		auth: {
			user: 'myUser',
			pass: 'myPasswd'
		},
		debug: false
	});

	smtpClient.on('debug', function (msg) {
		console.log(msg);
	});

	smtpClient.once('idle', function () {
		smtpClient.useEnvelope({
			from: "matthias.ohlemeyer@web.de",
			to: ["mohlemeyer@gmail.com"]
		});

		self.fakeSmtpServer.send('250 Requested mail action okay, completed\r\n');
		self.fakeSmtpServer.send('250 OK\r\n');
		equal(self.fakeClientSocket.write.lastCall.args[0].toString('utf-8').indexOf('DATA'), 0, 'DATA command sent to server');		

		start();
	});

	vertx.setTimer(100, function () {
		self.fakeSmtpServer.send('220 Service ready\r\n');
		self.fakeSmtpServer.send('250-Hello\r\n');
		self.fakeSmtpServer.send('250 AUTH LOGIN PLAIN\r\n');
		self.fakeSmtpServer.send('235 Authentication succeeded\r\n');
	});
});

asyncTest('Should emit "message" event', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';
	var clientName = 'myClient';
	var messageCallback = sinon.spy();

	var smtpClient = getSmtpClient(port, host, {
		name: clientName,
		ignoreTLS: true,
		auth: {
			user: 'myUser',
			pass: 'myPasswd'
		},
		debug: false
	});

	smtpClient.on('debug', function (msg) {
		console.log(msg);
	});

	smtpClient.once('idle', function () {
		smtpClient.useEnvelope({
			from: "matthias.ohlemeyer@web.de",
			to: ["mohlemeyer@gmail.com"]
		});

		self.fakeSmtpServer.send('250 Requested mail action okay, completed\r\n');
		self.fakeSmtpServer.send('250 OK\r\n');

		ok(!messageCallback.called, 'Message callback initially not called');
		self.fakeSmtpServer.send('354 Start mail input\r\n');
		ok(messageCallback.called, 'Message callback called after server sent 354');
		start();
	});

	smtpClient.on("message", messageCallback);

	vertx.setTimer(100, function () {
		self.fakeSmtpServer.send('220 Service ready\r\n');
		self.fakeSmtpServer.send('250-Hello\r\n');
		self.fakeSmtpServer.send('250 AUTH LOGIN PLAIN\r\n');
		self.fakeSmtpServer.send('235 Authentication succeeded\r\n');
	});
});

asyncTest('Should emit "ready" event', function () {
	var self = this;
	var port = 44;
	var host = 'smtp.x.net';
	var clientName = 'myClient';
	var readyCallback = sinon.spy();

	var smtpClient = getSmtpClient(port, host, {
		name: clientName,
		ignoreTLS: true,
		auth: {
			user: 'myUser',
			pass: 'myPasswd'
		},
		debug: false
	});

	smtpClient.on('debug', function (msg) {
		console.log(msg);
	});

	smtpClient.once('idle', function () {
		smtpClient.useEnvelope({
			from: "matthias.ohlemeyer@web.de",
			to: ["mohlemeyer@gmail.com"]
		});

		self.fakeSmtpServer.send('250 Requested mail action okay, completed\r\n');
		self.fakeSmtpServer.send('250 OK\r\n');
		self.fakeSmtpServer.send('354 Start mail input\r\n');
	});

	smtpClient.on("message", function () {
		smtpClient.end('Message content');

		ok(!readyCallback.called, 'Ready callback initially not called');
		self.fakeSmtpServer.send('250 Requested mail action okay\r\n');
		ok(readyCallback.called, 'Ready callback called after message has been sent');
		start();
	});

	smtpClient.on("ready", readyCallback);

	vertx.setTimer(100, function () {
		self.fakeSmtpServer.send('220 Service ready\r\n');
		self.fakeSmtpServer.send('250-Hello\r\n');
		self.fakeSmtpServer.send('250 AUTH LOGIN PLAIN\r\n');
		self.fakeSmtpServer.send('235 Authentication succeeded\r\n');
	});
});

var a_mailer = require('jslibs/a-mailer/lib/a-mailer');
var container = require('vertx/container');

//==========================================================================
QUnit.module('a-mailer.a-mailer', {
//  ========================================================================
	setup: function () {
		var that = this;
		
		this.fakeSmtpClient = {};
		this.fakeGetSmtpClient = sinon.spy(function () {
			that.fakeSmtpClient.on = sinon.spy();
			that.fakeSmtpClient.once = sinon.spy();
			that.fakeSmtpClient.useEnvelope = sinon.spy();
			that.fakeSmtpClient.close = sinon.spy();
			that.fakeSmtpClient.end = sinon.spy();
			that.fakeSmtpClient.quit = sinon.spy();
			return that.fakeSmtpClient;
		});
		a_mailer.setClientGetter(this.fakeGetSmtpClient);
	},
	teardown: function () {
		
	}
});
test('should have a "send" method', 1, function () {
	equal(typeof a_mailer.send, 'function', '"send" exists');
});
test('"send" should call callback with error on missing mandatory arguments', function () {
	var callback = sinon.spy();
	
	a_mailer.send(undefined, callback);
	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on missing "send data"');

	callback.reset();
	a_mailer.send({}, callback);
	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on missing "from"');

	callback.reset();
	a_mailer.send({
		from: 'abc@d.com'
	}, callback);
	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on missing "to"');
	
	callback.reset();
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com'
	}, callback);
	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on missing "subject"');
});
test('"send" should call callback with error on illegal "from" address', function () {
	var callback = sinon.spy();
	
	a_mailer.send({
		from: 'a b',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	}, callback);	

	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on illegal "from" data');
});
test('"send" should call callback with error on illegal "to" address', function () {
	var callback = sinon.spy();
	
	a_mailer.send({
		from: 'abc@d.com',
		to: 'c d',
		subject: 'Subject',
		body: 'bodytext'
	}, callback);	

	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on illegal "to" data');
});
test('"send" should call callback with error on one illegal "to" address of many', function () {
	var callback = sinon.spy();
	
	a_mailer.send({
		from: 'abc@d.com',
		to: ['hij@klm.com', 'c d', 'zyx@xyz.de'],
		subject: 'Subject',
		body: 'bodytext'
	}, callback);	

	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on illegal "to" data');
});
test('"send" should call callback with error with zero legal "to" addresses', function () {
	var callback = sinon.spy();
	
	a_mailer.send({
		from: 'abc@d.com',
		to: [],
		subject: 'Subject',
		body: 'bodytext'
	}, callback);	

	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error with zero legal "to" addresses');
});
test('"send" should call callback with error on illegal "cc" address', function () {
	var callback = sinon.spy();
	
	a_mailer.send({
		from: 'abc@d.com',
		to: 'uvw@xy.de',
		cc: 'c d',
		subject: 'Subject',
		body: 'bodytext'
	}, callback);	

	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on illegal "cc" data');
});
test('"send" should call callback with error on one illegal "cc" address of many', function () {
	var callback = sinon.spy();
	
	a_mailer.send({
		from: 'abc@d.com',
		to: 'uvw@xy.de',
		cc: ['hij@klm.com', 'c d', 'zyx@xyz.de'],
		subject: 'Subject',
		body: 'bodytext'
	}, callback);	

	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on illegal "cc" data');
});
test('"send" should call callback with error on illegal "bcc" address', function () {
	var callback = sinon.spy();
	
	a_mailer.send({
		from: 'abc@d.com',
		to: 'uvw@xy.de',
		bcc: 'c d',
		subject: 'Subject',
		body: 'bodytext'
	}, callback);	

	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on illegal "bcc" data');
});
test('"send" should call callback with error on one illegal "bcc" address of many', function () {
	var callback = sinon.spy();
	
	a_mailer.send({
		from: 'abc@d.com',
		to: 'uvw@xy.de',
		bcc: ['hij@klm.com', 'c d', 'zyx@xyz.de'],
		subject: 'Subject',
		body: 'bodytext'
	}, callback);	

	ok(callback.lastCall.args[0] instanceof Error, '"send" callback with error on illegal "bcc" data');
});
test('should call method to get a new SMTP client', function () {
	ok(!this.fakeGetSmtpClient.called, 'getSmtpClient initially not called');
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});	
	ok(this.fakeGetSmtpClient.calledOnce, 'getSmtpClient not called once after send');
	equal(this.fakeGetSmtpClient.firstCall.args[0], container.config.port || 25, 'Called with configured port');
	equal(this.fakeGetSmtpClient.firstCall.args[1], container.config.host || 'localhost', 'Called with configured host');
	equal(this.fakeGetSmtpClient.firstCall.args[2].ignoreTLS, true, 'Called with "ignoreTLS"');
});
test('should set error handler on smtp client', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});
	
	ok(this.fakeSmtpClient.on.called, 'Set handler method called');
	equal(this.fakeSmtpClient.on.firstCall.args[0], 'error', 'Handler set for "error" event');
	equal(typeof this.fakeSmtpClient.on.firstCall.args[1], 'function', '"error" handler set');
});
test('error handler should close the smtp client', function () {
	var sendCallback = sinon.spy();
	
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	}, sendCallback);

	var errorHandler = this.fakeSmtpClient.on.firstCall.args[1];
	errorHandler();
	ok(this.fakeSmtpClient.close.calledOnce, 'smtp client closed by error handler');
});
test('should set "receipt failed" handler on smtp client', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});
	
	equal(this.fakeSmtpClient.on.secondCall.args[0], 'rcptFailed', 'Handler set for "rcptFailed" event');
	equal(typeof this.fakeSmtpClient.on.secondCall.args[1], 'function', '"rcptFailed" handler set');
});
test('should set "idle" handler once', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});

	equal(this.fakeSmtpClient.once.firstCall.args[0], 'idle', 'Handler set for "idle" event');
	equal(typeof this.fakeSmtpClient.once.firstCall.args[1], 'function', '"idle" handler set');
});
test('"idle" handler should call "useEnvelope" with "from" and "to"', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});

	var idleHandler = this.fakeSmtpClient.once.firstCall.args[1];
	idleHandler();
	
	deepEqual(this.fakeSmtpClient.useEnvelope.firstCall.args[0],
			{ from: 'abc@d.com', to: ['bde@e.com']},
			'"useEnvelope" called with "from" and "to"');
});
test('"idle" handler should call "useEnvelope" with "from", "to", "cc" and "bcc"', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: ['to1@zzz.com', 'To Two <to2@zzz.com>', 'Name of to three <to3@zzz.com>'],
		cc: 'C and C <cc1@zzz.com>',
		bcc: ['Blind Carbon Copy <bcc1@zzz.com>', 'bcc2@zzz.com'],
		subject: 'Subject',
		body: 'bodytext'
	});

	var idleHandler = this.fakeSmtpClient.once.firstCall.args[1];
	idleHandler();
	
	deepEqual(this.fakeSmtpClient.useEnvelope.firstCall.args[0],
			{ from: 'abc@d.com', to: ['to1@zzz.com', 'to2@zzz.com',
			                          'to3@zzz.com', 'cc1@zzz.com',
			                          'bcc1@zzz.com', 'bcc2@zzz.com']},
			'"useEnvelope" called with "from", "to", "cc" and "bcc"');
});
test('should set "message" handler', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});
	
	equal(this.fakeSmtpClient.on.thirdCall.args[0], 'message', 'Handler set for "message" event');
	equal(typeof this.fakeSmtpClient.on.thirdCall.args[1], 'function', '"message" handler set');
});
test('"message" handler should call "end" with arguments', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'SubjectText',
		body: 'bodytext'
	});

	var messageHandler = this.fakeSmtpClient.on.thirdCall.args[1];
	messageHandler();
	
	ok(this.fakeSmtpClient.end.calledOnce, '"end" called by "message" handler');
	
	var endArg = this.fakeSmtpClient.end.firstCall.args[0].toString();
	
	ok(/From:\sabc@d.com/.test(endArg), 'Contains correct "From" line');
	ok(/To:\sbde@e.com/.test(endArg), 'Contains correct "To" line');
	ok(/Subject:\sSubjectText/.test(endArg), 'Contains correct "Subject" line');
	ok(/bodytext/.test(endArg), 'Contains correct "body" line');
});
test('should set "ready" handler', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});
	
	equal(this.fakeSmtpClient.on.getCall(3).args[0], 'ready', 'Handler set for "ready" event');
	equal(typeof this.fakeSmtpClient.on.getCall(3).args[1], 'function', '"ready" handler set');
});
test('"ready" handler should call "quit"', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});
	
	var readyHandler = this.fakeSmtpClient.on.getCall(3).args[1];
	readyHandler();
	
	ok(this.fakeSmtpClient.quit.calledOnce, '"quit" called by "ready" handler');
});
test('should set "end" handler', function () {
	a_mailer.send({
		from: 'abc@d.com',
		to: 'bde@e.com',
		subject: 'Subject',
		body: 'bodytext'
	});
	
	equal(this.fakeSmtpClient.on.getCall(4).args[0], 'end', 'Handler set for "end" event');
	equal(typeof this.fakeSmtpClient.on.getCall(4).args[1], 'function', '"end" handler set');
});
