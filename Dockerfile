FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM httpd:2.4-alpine
COPY httpd-eleclab.conf /usr/local/apache2/conf/extra/eleclab.conf
RUN echo "Include conf/extra/eleclab.conf" >> /usr/local/apache2/conf/httpd.conf
COPY --from=build /app/dist/ /usr/local/apache2/htdocs/
EXPOSE 1210
