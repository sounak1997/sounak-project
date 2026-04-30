const { getChannel, QUEUES } = require('../config/rabbitmq.config');

// SSE client registry: clientId -> res
const sseClients = new Map();

const addSSEClient = (clientId, res) => {
  sseClients.set(clientId, res);
  console.log(`[SSE] Client connected: ${clientId} (total: ${sseClients.size})`);
};

const removeSSEClient = (clientId) => {
  sseClients.delete(clientId);
  console.log(`[SSE] Client disconnected: ${clientId} (total: ${sseClients.size})`);
};

const broadcastToAll = (data) => {
  if (sseClients.size === 0) return;
  const message = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res, clientId) => {
    try {
      res.write(message);
    } catch {
      // Client pipe broken — clean up
      sseClients.delete(clientId);
    }
  });
};

const startConsumers = () => {
  const channel = getChannel();
  if (!channel) {
    console.warn('[Consumers] RabbitMQ channel not ready — retrying in 2s...');
    setTimeout(startConsumers, 2000);
    return;
  }

  // Consumer: user registration events
  channel.consume(QUEUES.USER_REGISTERED, (msg) => {
    if (!msg) return;
    const event = JSON.parse(msg.content.toString());
    console.log('[Consumer] USER_REGISTERED:', event.email);
    broadcastToAll({
      type: 'USER_REGISTERED',
      message: `New user joined: ${event.name} (${event.email})`,
      timestamp: event.timestamp,
    });
    channel.ack(msg);
  });

  // Consumer: general notifications
  channel.consume(QUEUES.NOTIFICATIONS, (msg) => {
    if (!msg) return;
    const event = JSON.parse(msg.content.toString());
    console.log('[Consumer] NOTIFICATION:', event.message);
    broadcastToAll({
      type: 'NOTIFICATION',
      message: event.message,
      timestamp: event.timestamp,
    });
    channel.ack(msg);
  });

  console.log('[Consumers] RabbitMQ consumers started');
};

module.exports = { startConsumers, addSSEClient, removeSSEClient, broadcastToAll };
