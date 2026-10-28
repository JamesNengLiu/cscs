// Synthetic BSP-style floor and team buy half-spaces for rules tests, never a playable map asset.
export const FLAT_MAP={
  version:'synthetic-rules-fixture',sourceSHA256:'synthetic',
  bounds:{min:[-100,3.2,-100],max:[100,20,100]},
  spawns:{T:[{x:-18.4,y:3.3,z:22,yaw:0}],CT:[{x:18.4,y:3.3,z:22,yaw:0}]},sites:[],
  planes:[[0,1,0,3.2],[0,1,0,4.1],[0,1,0,3.65],[1,0,0,0]],
  nodes:[[0,-1,-2]],clipnodes:[[1,-1,-2],[2,-1,-2],[3,-1,-2],[3,-2,-1]],
  models:[
    {index:0,entity:{classname:'worldspawn'},heads:[0,0,0,1]},
    {index:1,entity:{classname:'func_buyzone',team:'1'},heads:[0,2,2,2]},
    {index:2,entity:{classname:'func_buyzone',team:'2'},heads:[0,3,3,3]},
  ],
};
