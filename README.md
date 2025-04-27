# backop-backend


> Architecture diagram is on drawio: BackopsBackendArchi.drawio file.

### Deployment command

```
sam build && sam deploy
```

### To start
Install both npm and npm dev dependencies. 
And also cd into the lambdas directory and install the dependencies there as well. 
```
npm install --include=dev
```


Use AWS accelerate for speed development and directly sync local stack changes to cloud
Reference: https://medium.com/hashedone-technology/speed-up-your-serverless-development-with-aws-sam-accelerate-f692786a9482


### Things to be aware of 

1. Upload function has Throttling limit of 400. UI is supposed to have max limit of 100 files at once. Same applies for completeMultipart upload function.
2. Download function can download files in bulk and it works for thumbnails and original files. 
3. Similarly, delete function can delete files in bulk as well. 
