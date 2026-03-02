# Use the official Node.js LTS image as the base
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY ./app/package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of your app's source code
COPY ./app/. .

# Expose the port your app runs on
EXPOSE 8080

# Start the app
CMD ["node", "server.js"]