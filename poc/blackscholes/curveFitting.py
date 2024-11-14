import numpy as np
import csv
import pandas 
 
# curve-fit() function imported from scipy
from scipy.optimize import curve_fit
 
from matplotlib import pyplot as plt

def test(x, a, b, c):
    return (a*x**2 + b*x + c)
    
file_handle = open('../../generated.csv', mode='r', encoding='utf-8')
csvFile  = pandas.read_csv(file_handle,usecols=[0,1,2,3,4,5,6,7], names=['AA', 'AB','BA', 'BB','ssRatio','time','I','J','K']);
                      
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

my_list = [int(item) for item in set(J)] 

print(my_list);
#print(my_list.sort());

for index in my_list: #[1] : #
    res_list = [i for i in range(len(I)) if I[i] == index]
    if len(res_list): 
        np_lst = np.array(time[res_list]);
        sorted_indices = np_lst.argsort();
        res_list = [res_list[i] for i in sorted_indices]

        plt.plot(time[res_list], AA[res_list], '-', color ='red', label ="data")
        tt = time[res_list]
        param, param_cov = curve_fit(test, tt, AA[res_list])
        ans = (param[0] * tt**2 +  param[1]*tt + param[2])
        #plt.plot(tt, ans, 'o', color ='blue', label ="optimized data")

#plt.plot(time, AA, '-', color ='red', label ="data")
#param, param_cov = curve_fit(test, time, AA)
#ans = (param[0] * time * time + param[1]* time + param[2])
#plt.plot(time, ans, '-', color ='blue', label ="optimized data")


plt.show()