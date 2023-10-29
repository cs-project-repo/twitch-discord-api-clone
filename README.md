Twitch-Discord API Clone

Introduction

Welcome to the Twitch/Discord API Clone. This project emulates the functionality of both the Twitch and Discord APIs. It enables users to interact with their favorite content creators through live streaming, private one-on-one chats, and other features. Additionally, the project includes integration with the Stripe payment system to facilitate transactions.

Features

User Registration: Users can sign up by providing their email, username, and password. Email confirmation is required for account activation via SendGrid.

User Authentication: Registered users can log in using their credentials. The system generates access tokens and refresh tokens for authentication.

Token Refresh: Users can refresh their access tokens using refresh tokens, extending their session.

User Profile: Users can create and update their profiles, including uploading images and adding descriptions.

Payment Processing: The system supports payment processing for various services, including chats, live chats, and tip amounts. Stripe integration is used for handling payments.

Live Streaming: This feature allows users to create and manage rooms, ensuring efficient video communication. It includes automatic cleanup of idle rooms for resource optimization, using mediasoup for real-time live streaming.

1 on 1 Video Calls with WebRTC:
Provide one-on-one video calls using WebRTC and Socket.IO. Creators and their fans can connect seamlessly for high-quality video and audio interactions.

Private Chats:
Enhance user engagement with secure private chat rooms. Users can have one-on-one conversations with message storage and real-time typing indicators. Perfect for a comprehensive user experience.

Usage

Before running the application, configure your environment variables by referring to the provided `.env.example` file.

To start the application, use the following command:

```
npm start
```




