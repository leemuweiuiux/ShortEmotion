import {sectorflowAccess} from '../sectorflow/access.js';
import {pointsEtfflowStatus,POINTS} from '../points.js';
export const ETF_UNLOCK={unlockCost:POINTS.unlockEtfflow,unlockHours:POINTS.unlockHours};
export async function etfflowAccess(session,options={}){
 return {...await sectorflowAccess(session,{...options,status:options.status||pointsEtfflowStatus}),...ETF_UNLOCK};
}
