import math, datetime
import numpy as np
MU_SUN = 1.32712440018e11
AU = 149597870.7
EL = {  # a, da, e, de, I, dI, L, dL, peri, dperi, node, dnode (per century)
 'earth': (1.00000261,0.00000562,0.01671123,-0.00004392,-0.00001531,-0.01294668,100.46457166,35999.37244981,102.93768193,0.32327364,0.0,0.0),
 'jupiter':(5.20288700,-0.00011607,0.04838624,-0.00013253,1.30439695,-0.00183714,34.39644051,3034.74612775,14.72847983,0.21252668,100.47390909,0.20469106),
 'saturn':(9.53667594,-0.00125060,0.05386179,-0.00050991,2.48599187,0.00193609,49.95424423,1222.49362201,92.59887831,-0.41897216,113.66242448,-0.28867794),
 'uranus':(19.18916464,-0.00196176,0.04725744,-0.00004397,0.77263783,-0.00242939,313.23810451,428.48202785,170.95427630,0.40805281,74.01692503,0.04240589),
 'neptune':(30.06992276,0.00026291,0.00859048,0.00005105,1.77004347,0.00035372,-55.12002969,218.45945325,44.96476227,-0.32241464,131.78422574,-0.00508664),
}
MUP = {'jupiter':1.26686534e8,'saturn':3.7931187e7,'uranus':5.793939e6,'neptune':6.836529e6}
def jd(y,mo,d,h,mi):
    return (datetime.datetime(y,mo,d,h,mi)-datetime.datetime(2000,1,1,12,0)).total_seconds()/86400+2451545.0
def pos(name,j):
    a0,da,e0,de,i0,di,L0,dL,w0,dw,n0,dn = EL[name]
    T=(j-2451545)/36525
    a=(a0+da*T)*AU; e=e0+de*T; I=math.radians(i0+di*T); L=L0+dL*T; wb=w0+dw*T; Om=n0+dn*T
    M=math.radians((L-wb)%360); om=math.radians(wb-Om); Om=math.radians(Om)
    E=M
    for _ in range(30): E-= (E-e*math.sin(E)-M)/(1-e*math.cos(E))
    xp=a*(math.cos(E)-e); yp=a*math.sqrt(1-e*e)*math.sin(E)
    co,so,cO,sO,cI,sI=math.cos(om),math.sin(om),math.cos(Om),math.sin(Om),math.cos(I),math.sin(I)
    x=(co*cO-so*sO*cI)*xp+(-so*cO-co*sO*cI)*yp
    y=(co*sO+so*cO*cI)*xp+(-so*sO+co*cO*cI)*yp
    z=so*sI*xp+co*sI*yp
    ep=math.radians(23.43928)
    return np.array([x,y*math.cos(ep)-z*math.sin(ep),y*math.sin(ep)+z*math.cos(ep)])
def vel(name,j):
    h=0.5
    return (pos(name,j+h)-pos(name,j-h))/(h*2*86400)
def stumpff(z):
    if z>1e-6: s=math.sqrt(z); return (1-math.cos(s))/z,(s-math.sin(s))/s**3
    if z<-1e-6: s=math.sqrt(-z); return (math.cosh(s)-1)/(-z),(math.sinh(s)-s)/s**3
    return 0.5-z/24,1/6-z/120
def lambert(r1,r2,dt,mu=MU_SUN):
    n1,n2=np.linalg.norm(r1),np.linalg.norm(r2)
    cd=np.dot(r1,r2)/(n1*n2)
    dth=math.acos(max(-1,min(1,cd)))
    if (np.cross(r1,r2))[2]<0: dth=2*math.pi-dth
    A=math.sin(dth)*math.sqrt(n1*n2/(1-cd))
    def y(z):
        C,S=stumpff(z); return n1+n2+A*(z*S-1)/math.sqrt(C)
    def F(z):
        C,S=stumpff(z); yy=y(z); return (yy/C)**1.5*S+A*math.sqrt(yy)-math.sqrt(mu)*dt
    lo,hi=-4*math.pi**2,4*math.pi**2
    while y(lo)<0: lo+=0.1
    for _ in range(200):
        mid=(lo+hi)/2
        if F(mid)<0: lo=mid
        else: hi=mid
    z=(lo+hi)/2; yy=y(z)
    f=1-yy/n1; g=A*math.sqrt(yy/mu); gd=1-yy/n2
    return (r2-f*r1)/g,(gd*r2-r1)/g
def leg(a,ja,b,jb):
    return lambert(pos(a,ja),pos(b,jb),(jb-ja)*86400)
def flyby(name,jca,vin_h,vout_h,rp_true):
    vp=vel(name,jca); vi=vin_h-vp; vo=vout_h-vp
    mu=MUP[name]
    print(f"  {name}: |vinf in|={np.linalg.norm(vi):.2f} out={np.linalg.norm(vo):.2f} km/s")
    ui,uo=vi/np.linalg.norm(vi),vo/np.linalg.norm(vo)
    d=math.acos(np.dot(ui,uo)); vinf=(np.linalg.norm(vi)+np.linalg.norm(vo))/2
    e=1/math.sin(d/2); a=mu/vinf**2
    print(f"    turn {math.degrees(d):.1f} deg -> implied rp={a*(e-1):.0f} km (true {rp_true})")
V1=dict(L=jd(1977,9,5,12,56),J=jd(1979,3,5,12,5),S=jd(1980,11,12,23,46))
V2=dict(L=jd(1977,8,20,14,29),J=jd(1979,7,9,22,29),S=jd(1981,8,26,3,24),U=jd(1986,1,24,17,59),N=jd(1989,8,25,3,56))
for nm,M,seq,rps in (("V1",V1,['earth','jupiter','saturn'],[0,349000,184300]),("V2",V2,['earth','jupiter','saturn','uranus','neptune'],[0,570000,161300,107100,29300])):
    print(nm)
    ts=[M['L'],M['J'],M['S'],M.get('U'),M.get('N')][:len(seq)]
    legs=[leg(seq[i],ts[i],seq[i+1],ts[i+1]) for i in range(len(seq)-1)]
    v0=legs[0][0]-vel('earth',ts[0]); C3=np.dot(v0,v0)
    print(f"  launch C3={C3:.1f} km2/s2 (real ~100-107)")
    for i in range(1,len(seq)-1):
        flyby(seq[i],ts[i],legs[i-1][1],legs[i][0],rps[i])
