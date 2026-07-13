FROM node:18-alpine

# Install build dependencies for better-sqlite3 (node-gyp needs python, make, g++)
RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

ENV PORT=3000
ENV DB_PATH=/app/data/grid.db

# Create the data directory to hold the sqlite database
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
