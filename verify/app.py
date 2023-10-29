import uvicorn
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import cv2
import shutil
import base64
from io import BytesIO
import face_recognition
from typing import List, Dict
from pydantic import BaseModel
from nsfw_detector import predict
from PIL import Image
import sys
import os
from os.path import isfile, join
import torch
import torchvision
from torchvision import datasets, models, transforms
import uuid

#Setup
app = FastAPI(# max_request_size=500 * 1024 * 1024
) # 500MB-limit

#Cors Setup
origins = [
    "https://localhost",
    "https://localhost:3000",
    "http://localhost",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#Static Files
app.mount("/static", StaticFiles(directory="static"), name="static")

# @app.on_event("startup")
#     def on_startup:

@app.post("/FMD")
async def FMD(img1: bytes = File(...), img2: bytes = File(...), img3: bytes = File(...), ref1: bytes = File(...)):
    # Image 1
    image_name_1 = uuid.uuid4().hex
    image_path_1 = f"./static/images/{image_name_1}.jpg"
    with open(image_path_1, "wb") as f:
        f.write(img1)

    # Image 2
    image_name_2 = uuid.uuid4().hex
    image_path_2 = f"./static/images/{image_name_2}.jpg"
    with open(image_path_2, "wb") as f:
        f.write(img2)

    # Image 3
    image_name_3 = uuid.uuid4().hex
    image_path_3 = f"./static/images/{image_name_3}.jpg"
    with open(image_path_3, "wb") as f:
        f.write(img3)
        
    # Reference Image
    reference_name_1 = uuid.uuid4().hex
    reference_path_1 = f"./static/images/{reference_name_1}.jpg"
    with open(reference_path_1, "wb") as f:
        f.write(ref1)

    # Array
    array = [f'./static/images/{image_name_1}.jpg', f'./static/images/{image_name_2}.jpg', f'./static/images/{image_name_3}.jpg']

    results = []
    for i in range(0, len(array)):
        try:
            unknown = face_recognition.load_image_file(array[i])
            known = face_recognition.load_image_file(f'./static/images/{reference_name_1}.jpg')
            
            unknown_encoding = face_recognition.face_encodings(unknown)[0]
            known_encoding = face_recognition.face_encodings(known)[0]
            
            result = face_recognition.compare_faces([known_encoding], unknown_encoding)
            results.append(eval(str(result[0])))
        except IndexError:
            # Face not found, add False to results
            results.append(False)

    # Results
    # end = all(j == True for j in results)
    end = results

    if os.path.exists(f"./static/images/{reference_name_1}.jpg"):
        os.remove(f"./static/images/{reference_name_1}.jpg")

    if os.path.exists(f"./static/text/{reference_name_1}.txt"):
        os.remove(f"./static/text/{reference_name_1}.txt")

    if os.path.exists(f"./static/images/{image_name_1}.jpg"):
        os.remove(f"./static/images/{image_name_1}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_1}.txt"):
        os.remove(f"./static/text/{image_name_1}.txt")

    if os.path.exists(f"./static/images/{image_name_2}.jpg"):
        os.remove(f"./static/images/{image_name_2}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_2}.txt"):
        os.remove(f"./static/text/{image_name_2}.txt")

    if os.path.exists(f"./static/images/{image_name_3}.jpg"):
        os.remove(f"./static/images/{image_name_3}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_3}.txt"):
        os.remove(f"./static/text/{image_name_3}.txt")

    return end

@app.post("/NSFWD")
async def NSFWD(img1: bytes = File(...), img2: bytes = File(...), img3: bytes = File(...)):
    # Load Model
    model = predict.load_model('./static/models/nsfw_mobilenet2.224x224.h5')

    # Image 1
    image_name_1 = uuid.uuid4().hex
    image_path_1 = f"./static/images/{image_name_1}.jpg"
    with open(image_path_1, "wb") as f:
        f.write(img1)

    # Image 2
    image_name_2 = uuid.uuid4().hex
    image_path_2 = f"./static/images/{image_name_2}.jpg"
    with open(image_path_2, "wb") as f:
        f.write(img2)

    # Image 3
    image_name_3 = uuid.uuid4().hex
    image_path_3 = f"./static/images/{image_name_3}.jpg"
    with open(image_path_3, "wb") as f:
        f.write(img3)

        # Array
    array = [f'./static/images/{image_name_1}.jpg', f'./static/images/{image_name_2}.jpg', f'./static/images/{image_name_3}.jpg']

    # Inference
    results = []
    for i in range(0, len(array)):
        predictions = predict.classify(model, array[i])

        prediction = predictions.get(array[i])

        # print(prediction)

        porn = prediction.get('porn')
        hentai = prediction.get('hentai')

        if porn < .5 and hentai < .5:
            results.append(True)
        else:
            results.append(False)

    # Results    
    # end = all(j < .5 for j in results)
    end = results

    if os.path.exists(f"./static/images/{image_name_1}.jpg"):
        os.remove(f"./static/images/{image_name_1}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_1}.txt"):
        os.remove(f"./static/text/{image_name_1}.txt")

    if os.path.exists(f"./static/images/{image_name_2}.jpg"):
        os.remove(f"./static/images/{image_name_2}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_2}.txt"):
        os.remove(f"./static/text/{image_name_2}.txt")

    if os.path.exists(f"./static/images/{image_name_3}.jpg"):
        os.remove(f"./static/images/{image_name_3}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_3}.txt"):
        os.remove(f"./static/text/{image_name_3}.txt")

    return end

@app.post("/ND")
async def ND(img1: bytes = File(...), img2: bytes = File(...), img3: bytes = File(...)):
    # Image 1
    image_name_1 = uuid.uuid4().hex
    image_path_1 = f"./static/images/{image_name_1}.jpg"
    with open(image_path_1, "wb") as f:
        f.write(img1)

    # Image 2
    image_name_2 = uuid.uuid4().hex
    image_path_2 = f"./static/images/{image_name_2}.jpg"
    with open(image_path_2, "wb") as f:
        f.write(img2)

    # Image 3
    image_name_3 = uuid.uuid4().hex
    image_path_3 = f"./static/images/{image_name_3}.jpg"
    with open(image_path_3, "wb") as f:
        f.write(img3)

    # Load Model
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    model = torch.load('./static/models/ptm=resnet50_batch=16_step-size=14_lr=0.006.pth', map_location=device).to(device)
    model.eval()

    mean = np.array([0.5, 0.5, 0.5])
    std = np.array([0.25, 0.25, 0.25])
    transform_tensor = transforms.Compose([
            transforms.Resize(224),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean, std)
        ])

    # Array
    array = [f'./static/images/{image_name_1}.jpg', f'./static/images/{image_name_2}.jpg', f'./static/images/{image_name_3}.jpg']

    # Inference
    results = []
    for i in range(0, len(array)):
        img = Image.open(array[i]).convert('RGB')

        img_y = transform_tensor(img).unsqueeze(0).float().to(device)

        prediction = torch.argmax(model(img_y))
        if (prediction==0):
            results.append(True)
        else:
            results.append(False)  

    # Results    
    # end = all(j == True for j in results)
    end = results

    if os.path.exists(f"./static/images/{image_name_1}.jpg"):
        os.remove(f"./static/images/{image_name_1}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_1}.txt"):
        os.remove(f"./static/text/{image_name_1}.txt")

    if os.path.exists(f"./static/images/{image_name_2}.jpg"):
        os.remove(f"./static/images/{image_name_2}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_2}.txt"):
        os.remove(f"./static/text/{image_name_2}.txt")

    if os.path.exists(f"./static/images/{image_name_3}.jpg"):
        os.remove(f"./static/images/{image_name_3}.jpg")
    
    if os.path.exists(f"./static/text/{image_name_3}.txt"):
        os.remove(f"./static/text/{image_name_3}.txt")

    return end
    
if __name__ == '__main__':
    uvicorn.run(app,host="127.0.0.1",port="8001")