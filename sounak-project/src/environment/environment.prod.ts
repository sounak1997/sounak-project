// src/environments/environment.prod.ts
export const environment = {
  production: true,
  // IMPORTANT: Replace this with your actual EC2 Public IPv4 DNS and port (e.g., 3000)
  // Use HTTP for now, unless you've set up HTTPS on your EC2 backend
  apiUrl: 'http://ec2-34-201-57-231.compute-1.amazonaws.com:3000/api'
};