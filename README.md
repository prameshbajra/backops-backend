# backop-backend

### Deployment command

```
sam build && sam deploy
```

Use AWS accelerate for speed development and directly sync local stack changes to cloud
Reference: https://medium.com/hashedone-technology/speed-up-your-serverless-development-with-aws-sam-accelerate-f692786a9482


### Things to be aware of 

1. Upload function has Throttling limit of 400. UI is supposed to have max limit of 100 files at once. Same applies for completeMultipart upload function.
2. Download function can download files in bulk and it works for thumbnails and original files. 
3. Similarly, delete function can delete files in bulk as well. 