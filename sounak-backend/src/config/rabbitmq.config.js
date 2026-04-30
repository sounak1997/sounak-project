const amqp = require('amqplib');

let channel = null;
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

const QUEUES = {
  USER_REGISTERED: 'user_registered',
  NOTIFICATIONS: 'notifications',
};

const connectRabbitMQ = async () => {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // Declare all queues as durable so messages survive broker restarts
    await channel.assertQueue(QUEUES.USER_REGISTERED, { durable: true });
    await channel.assertQueue(QUEUES.NOTIFICATIONS, { durable: true });

    console.log('[RabbitMQ] Connected and queues declared');

    connection.on('error', (err) => {
      console.error('[RabbitMQ] Connection error:', err.message);
    });
    connection.on('close', () => {
      console.warn('[RabbitMQ] Connection closed — reconnecting in 5s...');
      channel = null;
      setTimeout(connectRabbitMQ, 5000);
    });
  } catch (err) {
    console.error('[RabbitMQ] Connection failed:', err.message, '— retrying in 5s...');
    setTimeout(connectRabbitMQ, 5000);
  }
};

const getChannel = () => channel;

module.exports = { connectRabbitMQ, getChannel, QUEUES };
