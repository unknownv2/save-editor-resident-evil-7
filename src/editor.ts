import { computedFrom, newInstance } from 'aurelia-framework';
import * as Blowfish from "egoroof-blowfish";

import { Stream, SeekOrigin } from 'libvantage';
import {  murmurHash, murmurHash3Str } from './murmur3';
import { Savegame, ElementList } from './savedata';
import { DictionaryCollection } from './collections';
import { InventoryCollection } from './inventory';
import inventoryItemList from './items';
import {ObjectType} from './object';

import {Tree, TreeNode, TreeComponent} from 'libvantage';

// index = playerID
const itemsPathId =  'InventorySaveDataDicList:Table:app.SaveData.DicList`2<app.PlayerID,app.InventorySaveData>[0]:Value:Items';
const boxItemsPathId = 'InventorySaveDataDicList:Table:app.SaveData.DicList`2<app.PlayerID,app.InventorySaveData>[0]:Value:ItemBoxItems';
const equippedItemId = 'InventorySaveDataDicList:Table:app.SaveData.DicList`2<app.PlayerID,app.InventorySaveData>[0]:Value:EquipItemID';
const blowFishBlockSize = 8;

const boxInventoryTreeName = 'boxInventory';
const playerInventoryName = 'playerInventory';

export class Editor {
    private buffer: Buffer;
    
    private key = 'hHGb4nS653aRT29jy';

    private murmurSeed = 0xFFFFFFFF;

    public availableItems = inventoryItemList.map(item => ({
        label: item,
        value: item,
    }));
    public selectedItem: string;
    public blowfish : Blowfish;
    public saveData : Buffer;
    public saveSlot : number;
    public saveHeader : Buffer;
    public invNodes: TreeNode[];
    public invTree : Tree;

    private properties: ElementList;
    public saveGame: Savegame;
    private inventoryData: InventorySaveData;
    private inventoryItems: InventoryCollection;
    private inventoryBoxItems: InventoryCollection;

    public itemCount: number;
    
    public load(buffer: Buffer) {
        this.buffer = buffer;
   
        this.decryptSave();        
  
        this.loadSaveData();
        if(this.availableItems && this.availableItems.length > 0) {
            this.selectedItem = this.availableItems[0].label;
        }
        this.itemCount = 1;
    }

    private loadSaveData(): void {
        this.inventoryData = new InventorySaveData();
        this.saveGame = new Savegame(this.saveData);

        this.displayTree(this.saveGame);
    }

    private displayTree(savegame: Savegame) : void {
        const tmp =  savegame.properties[0].entries[26];
        const properties = savegame.properties[0];

        const invItems = properties.findElementByPath(itemsPathId);
        
        this.inventoryItems = new InventoryCollection(invItems, true);
        this.invNodes = [];
        const statNodes = [];
        for(const item of this.inventoryItems.items) {
            statNodes.push(this.createItemNode(item));
        }
        const boxItems = properties.findElementByPath(boxItemsPathId);            
        this.inventoryBoxItems = new InventoryCollection(boxItems, true);        
        const boxNodes = [];
        for(const item of this.inventoryBoxItems.items) {              
            boxNodes.push(this.createItemNode(item));
        }
        const equipped = properties.findElementByPath(equippedItemId);
        this.inventoryData.EquipItemID = equipped.getBuffer().toString();
        this.invNodes.push(
            {
                name : 'Player Inventory',
                id : playerInventoryName,
                nodes : statNodes,
            },
            {
                name : 'Box Items',
                id : boxInventoryTreeName,
                nodes : boxNodes,
            },
            {
                name : 'Equipped Item',
                id : 'equipped',
                nodes : [
                    this.createTextStatNode('EquipItemID', 'Equipped Item', this.inventoryData),
                ],
            }          
        );  
        this.properties = properties;
    }

    public decryptSave(): void {
        let stream = new Stream(this.buffer);
        stream.position = 0;
        const remainder = stream.length % blowFishBlockSize;
        let decryptedBuffer = this.decryptBlock(stream.readBytes(this.buffer.length - remainder));
        let tmpStream = new Stream(decryptedBuffer);
        tmpStream.position = decryptedBuffer.length;
        // read any unencrypted bytes
        tmpStream.writeBytes(stream.readBytes(remainder));
        this.saveData = tmpStream.getBuffer(); // get final stream
    }

    public addToInventory(playerInventory: boolean): void {
        if(playerInventory) {
            this.addItemToInventory(this.inventoryItems, playerInventoryName);  
        }
        else {
            this.addItemToInventory(this.inventoryBoxItems, boxInventoryTreeName);  
        }
    }

    private addItemToInventory(inventory: InventoryCollection, inventoryName: string): void {
        const newItem = {
            ItemDataID: this.createItemProperty(ObjectType.UnicodeString, this.selectedItem),
            Num: this.createItemProperty(ObjectType.Int32, this.itemCount),
            SlotNo: this.createItemProperty(ObjectType.Int32, (<InventoryCollection>inventory).getFreeSlot()),
            SlotRotation: this.createItemProperty(ObjectType.Single, 0.0),
            WeaponGunSaveData: this.createItemProperty(ObjectType.Class, null),          
            isAdditional: this.createItemProperty(ObjectType.Boolean, false),                                
        };
        this.addItemToNode(this.invTree.findNodeByPath(inventoryName), 
        this.addItemToInventoryList(inventory, newItem));
    }
    private createItemProperty(objectType: ObjectType, objectData: any): any {
        return {
            objectType: objectType,
            data: objectData,
        }
    }
    private addItemToNode(node: TreeNode, item: any): void {
        node.nodes.push(this.createItemNode(item)); 
    }
    
    private addItemToInventoryList(inventory: DictionaryCollection, item: any): any {
        return inventory.insert(item);
    }
    private createItemNode(item: any): TreeNode {
        const node = this.createSelectionNode('ItemDataID', 'Item', item);
        node.nodes = [this.createStatNode('Num', 'Amount', item)];
        return node;
    }
    
    private saveProperties(): void {
        if(this.inventoryData.EquipItemID) {
            this.saveGame.properties[0].findElementByPath(equippedItemId).setBuffer(Buffer.from(this.inventoryData.EquipItemID));
        }
        this.saveInventoryProperties(this.inventoryItems);
        this.saveInventoryProperties(this.inventoryBoxItems);
    }

    private saveInventoryProperties(collection: DictionaryCollection): void {
        for(let item of collection.items) {
            for(let prop in item) {
                collection.setValue(item.index, prop, item[prop]);
            }
        }
    }

    private serializeSaveData(): Buffer {
        return this.saveGame.toBuffer();
    }

    public save(): Buffer {
        this.saveProperties();
        this.saveData = this.serializeSaveData();
        return  this.encryptSaveToBuffer();
    }

    public encryptSaveToBuffer(): Buffer {
        return this.encryptUWPSaveToBuffer();
    }
    public encryptUWPSaveToBuffer(): Buffer {
        let stream = new Stream(this.saveData);
        stream.position = 0;
        const remainder = stream.length % blowFishBlockSize;
        let encryptedBuffer = this.encryptBlock(stream.readBytes(this.saveData.length - remainder));
        let tmpStream = new Stream(encryptedBuffer);
        tmpStream.position = encryptedBuffer.length;
        // read any unencrypted bytes
        tmpStream.writeBytes(stream.readBytes(remainder));
        this.saveData = tmpStream.getBuffer(); // get final stream
        return this.saveData;
    }  

    public decryptBlock(array: Buffer): Buffer {		
        return this.reverseArrayByDword(this.getBlowfishContext().decode(this.reverseArrayByDword(array),  Blowfish.TYPE.UINT8_ARRAY));
    }
    public encryptBlock(array: Buffer): Buffer {		
        return this.reverseArrayByDword(this.getBlowfishContext().encode(this.reverseArrayByDword(array),  Blowfish.TYPE.UINT8_ARRAY));
    }
    public decryptBlockToTxt(array: Buffer): string {
        return this.reverseArrayByDword(this.getBlowfishContext().decode(this.reverseArrayByDword(array),  Blowfish.TYPE.UINT8_ARRAY)).toString("utf8");
    }
    public reverseArrayByDword(array: Buffer ): Buffer {
        if((array.length % 4) !== 0)
            throw new Error("invalid array length");

        var tmp = Buffer.from(array);
        tmp.swap32();
        return tmp;
    }
    public getBlowfishContext() : Blowfish {
        if(!this.blowfish) {
            this.blowfish = new Blowfish(this.key, Blowfish.MODE.CBC, Blowfish.PADDING.NULL);
        }
        this.blowfish.setIv(new Buffer(8));// iv is set to 0's at the beginning
        return this.blowfish;
    }
    public createStatNode(id : string, name: string, object: any ) : any {
        return {
            id: id,
            name: name,
            component : new PlayerStatComponent(object, id),
        }
    }
    public createTextStatNode(id: string, name: string, object: any ): any {
        return {
            id: id,
            name: name,
            component : new PlayerTextStatComponent(object, id),
        }
    }
    public createSelectionNode(id: string, name: string, object: any ): any {
        return {
            id: id,
            name: name,
            component : new PlayerSlectionComponent(object, id, this.availableItems),
        }
    }    
    public maxAllItemsInInventory(playerInventory: boolean): void {
        if(playerInventory) {
            this.maxItemsInInventory(this.inventoryItems);
        }
        else {
            this.maxItemsInInventory(this.inventoryBoxItems);
        }
    }

    private maxItemsInInventory(inventory: DictionaryCollection, max?:number) {
        for(let item of inventory.items) {
            item.Num = max || 999;
        }
    }
}
export class PlayerStatComponent implements TreeComponent {
    public type : "number";
    public statObject : any;
    public statId : string;
    public step : number;
    public min : number;
    public max : number;

    constructor(stat : any, id: string, max? : number) {
        this.statObject = stat;
        this.statId = id;
        this.type = 'number';
        this.min = 0;
        this.step = 1;
        this.max = max || 999999;
    }
    @computedFrom('statObject[statId]')
    public get value(): number {
        return this.statObject[this.statId];
    }

    public set value(value: number) {
        this.statObject[this.statId] = value;
    }
}
export class InventorySaveData {
    public EquipItemID: string;
}
export class PlayerTextStatComponent implements TreeComponent {
    public type : "text";
    public statObject : any;
    public statId : string;

    constructor(stat : any, id: string, max? : number) {
        this.statObject = stat;
        this.statId = id;
        this.type = 'text';
    }

    @computedFrom('statObject[statId]')
    public get value(): string {
        return this.statObject[this.statId];
    }

    public set value(value: string) {
        this.statObject[this.statId] = value;
    }
}
export class PlayerSlectionComponent implements TreeComponent {
    public type : "selection";
    public statObject : any;
    public statId : string;
    public options : any[];
    constructor(stat : any, id: string, options: any[], max? : number) {
        this.statObject = stat;
        this.statId = id;
        this.type = 'selection';
        this.options = options;
    }

    @computedFrom('statObject[statId]')
    public get value(): string {
        return this.statObject[this.statId];
    }

    public set value(value: string) {
        this.statObject[this.statId] = value;
    }
}