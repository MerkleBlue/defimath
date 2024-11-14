import numpy as np
import csv
import pandas 
 
# curve-fit() function imported from scipy
from scipy.optimize import curve_fit
 
from matplotlib import pyplot as plt

def test(x, a, b, c):
    return (a*x**2 + b*x + c)
    
file_handle = open('../../generated.csv', mode='r', encoding='utf-8')
csvFile  = pandas.read_csv(file_handle,usecols=[0,1,2,3,4,5,6,7,8], names=['AA', 'AB','BA', 'BB','ssRatio','time','I','J','K']);
                      
AA = np.array(csvFile['AA'].tolist())
AB = np.array(csvFile['AB'].tolist()) 
BA = np.array(csvFile['BA'].tolist()) 
BB = np.array(csvFile['BB'].tolist()) 
ssRatio = np.array(csvFile['ssRatio'].tolist()) 
time = np.array(csvFile['time'].tolist()) 
I = np.array(csvFile['I'].tolist()) 
J = np.array(csvFile['J'].tolist()) 
K = np.array(csvFile['K'].tolist()) 

littleChunks = [int(item) for item in set(K)] 

for littleChunksIndex in littleChunks: #range(5000,5005):
    new_subset = [k for k in range(len(K)) if K[k] == littleChunksIndex]
    print(new_subset);
    Jprime = J[new_subset];
    Iprime = I[new_subset];


    AAprime = AA[new_subset];
    print(AAprime);
    timeprime = time[new_subset];
    print(timeprime);

    plt.plot(timeprime, AAprime, '-', color ='red', label ="data")
    param, param_cov = curve_fit(test, timeprime, AAprime)
    ans = (param[0] * timeprime**2 +  param[1]*timeprime + param[2])
    plt.plot(timeprime, ans, '-', color ='blue', label ="optimized data")
    plt.draw(); 


plt.show();