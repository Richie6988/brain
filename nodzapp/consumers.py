import json
from channels.generic.websocket import AsyncWebsocketConsumer

class MyConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Extract token from query string (e.g., ws://localhost:8000/ws/?token=abcd1234)
        self.token = self.scope['query_string'].decode().split('=')[1]
        # print('token', self.token)
        self.room_group_name = f"session_{self.token}"  # Unique group based on the invite token

        # Add the user to the room group
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        self.user_id = None


    async def disconnect(self, close_code):
        # Notify the group that the user has disconnected
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_disconnected',
                'user_id': self.user_id  # Send the user ID that disconnected
            }
        )

        # Leave the room group
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        # Receive message from WebSocket (mouse position data)
        data = json.loads(text_data)
        # Set user_id based on the first received message
        if not self.user_id and 'userID' in data:
            self.user_id = data['userID']
        # Check if 'mouse_position' exists in data, otherwise handle appropriately
        if 'mouse_position' in data:
            # Send mouse position data to the group
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'mouse_position',
                    'userID': data['userID'],
                    'userName': data['userName'],
                    'mouse_position': data['mouse_position']
                }
            )
        else:
            print("Received data does not contain 'mouse_position'")

    # Handler for 'mouse_position' message type
    async def mouse_position(self, event):
        # Send the mouse position data to WebSocket
        await self.send(text_data=json.dumps({
            'userID': event['userID'],
            'userName': event['userName'],
            'mouse_position': event['mouse_position']
        }))

    async def user_disconnected(self, event):
        # Send the disconnection message to the WebSocket
        await self.send(text_data=json.dumps({
            'userDisconnected': event['user_id']
        }))


