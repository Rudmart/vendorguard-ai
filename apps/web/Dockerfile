FROM node:26-alpine
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY .next ./.next
COPY next.config.mjs .
EXPOSE 3000
ENV PORT=3000
CMD ["npm", "start"]
