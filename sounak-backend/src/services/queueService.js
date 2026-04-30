const { getChannel, QUEUES } = require('../config/rabbitmq.config');

const publish = (queue, message) => {
  const channel = getChannel();
  if (!channel) {
    console.warn('[Queue] Channel not ready — skipping publish to', queue);
    return false;
  }
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
  console.log(`[Queue] Published to "${queue}":`, message);
  return true;
};

const publishUserRegistered = (user) => {
  return publish(QUEUES.USER_REGISTERED, {
    event: 'USER_REGISTERED',
    userId: String(user._id),
    name: user.name,
    email: user.email,
    timestamp: new Date().toISOString(),
  });
};

const publishNotification = (message) => {
  return publish(QUEUES.NOTIFICATIONS, {
    event: 'NOTIFICATION',
    message,
    timestamp: new Date().toISOString(),
  });
};

module.exports = { publish, publishUserRegistered, publishNotification, QUEUES };
