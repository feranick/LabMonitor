def sendDataMongo(self, url, data):
        print("-" * 40)
        print(f"Attempting to POST data to: {url}")
        print(f"Payload: {json.dumps(data)}")
        
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        if self.mongoSecretKey:
            headers['Authorization'] = f'Bearer {self.mongoSecretKey}'
        
        try:
            response = self.requests.post(
                url,
                json=data,
                headers=headers,
                timeout=10 # Set a timeout for the request
            )

            # Check for success (HTTP 200 series status code)
            if response.status_code == 200:
                print("Data successfully sent!")
                print("Server Response:", response.text)
            else:
                print(f"Server returned status code: {response.status_code}")
                try:
                    # Try to print JSON error response if available
                    print("Server Error Details:", response.json())
                except:
                    # Fallback to printing raw text
                    print("Server Error Text:", response.text)

            response.close() # Crucial: always close the response object

        except Exception as e:
            print(f"An error occurred during the POST request: {e}")
