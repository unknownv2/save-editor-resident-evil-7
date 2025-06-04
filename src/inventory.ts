import  {TableListEntry, StructListEntry, ListEntry} from './savedata';
import {DictionaryCollection} from './collections';

export class InventoryCollection implements DictionaryCollection{
    public items: any[] = [];
    public list: ListEntry;
    private usedSlots: number[];
    private boxInventory: boolean;
 
    constructor(list: ListEntry, boxInventory: boolean) {
        this.usedSlots = [];

        list.children.forEach((c, i) => {
            const invData = this.parseListEntry(c);
            invData.index = i;
            this.items.push(invData);
            this.usedSlots.push(invData.SlotNo);
        });
        this.list = list;
        this.boxInventory = boxInventory;
    }

    public getFreeSlot(): number {
        
        if(this.boxInventory) {
            return 0;
        }

        let i = 0;
        while(this.usedSlots.includes(i++));
        this.usedSlots.push(i);
        return i;
    }
    // retrieve and set structure buffers directly 
    public getBufferFromEntry(entry: ListEntry, id: string): Buffer {
        const result = entry.findChildByName(id);
        if(result.length === 1) {
            const keyProp = <TableListEntry>result[0];
            if(keyProp){
                return keyProp.getBuffer();
            }
        }
        return null;
    }

    public setBufferForEntry(index:number, id: string, data: Buffer): void {
        const result = this.list.children[index].findChildByName(id);
        if(result.length === 1) {
            const keyProp = result[0];
            if(keyProp){
                keyProp.setBuffer(data);
            }
        }
    }
    public setValue(index:number, id: string, data: string|number|boolean): void {
        const result = this.list.children[index].findChildByName(id);
        if(result.length === 1) {
            const keyProp = <TableListEntry>result[0];
            if(keyProp){
                keyProp.setBuffer(TableListEntry.serializeObject(keyProp.entryId.type, data));
            }
        }
    }    
    public getValue(entry: ListEntry, id: string): string|number|boolean {
        const result = entry.findChildByName(id);
        if(result.length === 1) {
            const keyProp = <TableListEntry>result[0];
            if(keyProp){
                return TableListEntry.deserializeObject(keyProp.entryId.type, keyProp.getBuffer());
            }
        }
        return null;
    }
    public insert(structure: any):any {
        const entry = StructListEntry.create(0x66C3A8D0);
        let newItem = {};
        for(let prop in structure) {
            entry.children.push(TableListEntry.create(prop, structure[prop]));
            newItem[prop] = structure[prop].data;
        }
        newItem['index'] = this.list.children.length;

        this.items.push(newItem);        
        this.list.insert(entry);

        return newItem;
    }

    public parseListEntry(list: ListEntry): any {
        return  {
            ItemDataID : this.getValue(list, 'ItemDataID'),
            Num : this.getValue(list, 'Num'),
            SlotNo : this.getValue(list, 'SlotNo'),
            SlotRotation : this.getValue(list, 'SlotRotation'),
            isAdditional : this.getValue(list, 'isAdditional'),
            //WeaponGunSaveData: c.findChildByName('WeaponGunSaveData'),
        };
    }
}