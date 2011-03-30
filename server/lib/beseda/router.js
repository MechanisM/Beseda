var Session  = require('./session.js'),
    Channel  = require('./channel.js');

var ConnectionRequest     = require('./requests/connection.js'),
    SubscriptionRequest   = require('./requests/subscription.js'),
    PublicationRequest    = require('./requests/publication.js'),
    UnsubscriptionRequest = require('./requests/unsubscription.js');

require('./utils.js');

Router = module.exports = function(server) {
    this.server = server;
}

Router.prototype.dispatch = function(client, messages) {
    if (!Array.isArray(messages)) {
        client.send([{
            channel : '/meta/error',
            data    : 'Unsupported data (must be array of messages)'
        }]);
    }

    for (var message in messages) {
        if (message.channel == undefined || message.clientId == undefined || message.id == undefined) {
            client.send([{
                channel : '/meta/error',
                data    : 'channel, clientId or id not present'
            }]);

            continue;
        }

        if (message.channel.indexOf('/meta/') == 0) {
            var metaChannel = message.channel.substr(6);

            if (!metaChannel in ['connect', 'subscribe', 'unsubscribe']) {
                client.send([{
                    id       : message.id,
                    channel  : '/meta/error',
                    clientId : message.clientId,
                    data     : 'Meta channel ' + message.channel + ' not supported'
                }]);

                continue;
            }
            this['_' + metaChannel].call(this, client, message);
        } else if (message.channel.indexOf('/service/') == 0) {
            client.send([{
                id       : message.id,
                channel  : '/meta/error',
                clientId : message.clientId,
                data     : 'Service channels not supported'
            }]);
        } else if (message.channel.indexOf('/') == 0) {
            this._publish(client, message);
        } else {
            client.send([{
                id       : message.id,
                channel  : '/meta/error',
                clientId : message.clientId,
                data     : 'Channel name must be start with /'
            }]);
        }
    }
}

Router.prototype._connect = function(client, message) {
    var session = new Session(this.server, message.clientId, client);

    var request = new ConnectionRequest(session, message);

    var listeners = this.server.listeners('connect');
    if (listeners.length) {
        this.server.emit('connect', request, message);
    } else {
        request.approve();
    }
}

Router.prototype._subscribe = function(client, message) {
    if (message.subscription == undefined) {
        return client.send([{
            id           : message.id,
            channel      : '/meta/subscribe',
            clientId     : message.clientId,
            successful   : false,
            subscription : '',
            error        : 'You must have a subscription in your subscribe message'
        }]);
    }

    var session = client.session;
    if (!session) {
        return client.send([{
            id           : message.id,
            channel      : '/meta/subscribe',
            clientId     : message.clientId,
            successful   : false,
            subscription : message.subscription,
            error        : 'You must send connection message before'
        }]);
    }

    if (session.id != message.clientId) {
        throw 'Client.session not equal message.clientId';
    }

    var channels = [];
    var subscriptions = Array.ensure(message.subscription);
    for (var channelName in subscriptions) {
        if (channelName.indexOf('/meta/') == 0) {
            return client.send({
                id           : message.id,
                channel      : '/meta/subscribe',
                clientId     : message.clientId,
                successful   : false,
                subscription : message.subscription,
                error        : 'You can\'t subscribe to meta channel ' + channelName
            });
        }

        if (channelName.indexOf('*') != -1) {
            return client.send({
                id           : message.id,
                channel      : '/meta/subscribe',
                clientId     : message.clientId,
                successful   : false,
                subscription : message.subscription,
                error        : 'Wildcards not supported yet'
            });
        }

        var channel = Channel.get(channelName);
        if (!channel) {
            channel = new Channel(this, channelName);
        }

        if (channel.isSubscribed(session)) {
            return client.send({
                id           : message.id,
                channel      : '/meta/subscribe',
                successful   : false,
                subscription : message.subscription,
                error        : 'You already subscribed to ' + channelName
            });
        }

        channels.push(channel);
    }

    var request = new SubscriptionRequest(session, message, channels);

    var listeners = this.server.listeners('subscribe');
    if (listeners.length) {
        this.server.emit('subscribe', request, message);
    } else {
        request.approve();
    }
}

Router.prototype._unsubscribe = function(client, message) {
    if (message.subscription == undefined) {
        return client.send([{
            id           : message.id,
            channel      : '/meta/unsubscribe',
            clientId     : message.clientId,
            successful   : false,
            subscription : '',
            error        : 'You must have a subscription in your unsubscribe message'
        }]);
    }

    var session = client.session;
    if (!session) {
        return client.send([{
            id           : message.id,
            channel      : '/meta/unsubscribe',
            clientId     : message.clientId,
            successful   : false,
            subscription : message.subscription,
            error        : 'You must send connection message before'
        }]);
    }

    if (session.id != message.clientId) {
        throw 'Client.session not equal message.clientId';
    }

    var channels = [];
    var subscriptions = Array.ensure(message.subscription);
    for (var channelName in subscriptions) {
        if (channelName.indexOf('*') != -1) {
            return client.send({
                id           : message.id,
                channel      : '/meta/unsubscribe',
                clientId     : message.clientId,
                successful   : false,
                subscription : message.subscription,
                error        : 'Wildcards not supported yet'
            });
        }

        var channel = Channel.get(channelName);
        if (!channel) {
            throw 'Can\'t unsubscribe from ' + chanelName + ', becouse channel not present';
        }

        if (!channel.isSubscribed(session)) {
            return client.send({
                id           : message.id,
                channel      : '/meta/unsubscribe',
                clientId     : message.clientId,
                successful   : false,
                subscription : message.subscription,
                error        : 'You not subscribed to ' + channelName
            });
        }

        channels.push(channel);
    }

    var request = new UnsubscriptionRequest(session, message, channels);

    var listeners = this.server.listeners('unsubscribe');
    if (listeners.length) {
        this.server.emit('unsubscribe', request, message);
    } else {
        request.approve();
    }
}

Router.prototype._publish = function(client, message) {
    var session = client.session;
    if (!session) {
        return client.send([{
            id           : message.id,
            channel      : message.channel,
            clientId     : message.clientId,
            successful   : false,
            error        : 'You must send connection message before'
        }]);
    }

    if (session.id != message.clientId) {
        throw 'Client.session not equal message.clientId';
    }

    if (message.channel.indexOf('*') != -1) {
        return client.send([{
            id           : message.id,
            channel      : message.channel,
            clientId     : message.clientId,
            successful   : false,
            error        : 'Wildcards not supported yet'
        }]);
    }

    var channel = Channel.get(message.channel);
    if (!channel) {
        channel = new Channel(this.server, message.channel);
    }

    var request = new PublicationRequest(session, message, channel);

    var listeners = this.server.listeners('publish');
    if (listeners.length) {
        this.server.emit('publish', request, message);
    } else {
        request.approve();
    }
}