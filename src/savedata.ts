import { Stream } from 'libvantage';
import  saveProperties from './properties';
import { murmurHash, murmurHash3Str } from './murmur3';
import { children } from 'aurelia-framework';
import { ObjectType, ObjectStream } from './object';

const propertiesHashes = {};
saveProperties.forEach(prop => propertiesHashes[murmurHash3Str(prop, 0xFFFFFFFF)] = prop);

export class Savegame {
    private stream : ObjectStream;
    public properties : ElementList[];

    constructor(buffer: Buffer) {
        this.stream = new ObjectStream(buffer);
        this.properties = [];
        while(this.stream.position < this.stream.length) {
                this.properties.push(new ElementList(this.stream));
        }
    }

    public toBuffer(): Buffer {
        let io = new ObjectStream(new Buffer(2000));
        this.properties.forEach(element => {
            element.serialize(io);
        });
        return io.getBuffer();
    }
}
 // for UWP games metadata is in seperate file, for Steam, the data is all in one file
export class SavegameMetadata {
    private stream : ObjectStream;
    public properties : ElementList[];

    constructor(stream: ObjectStream) {
        this.stream = stream;

        this.properties = [];
        while(stream.position < stream.length) {
            this.properties.push(new ElementList(stream));
        }
    }
}
export class ElementList {
    public entries : ListEntry[];
    public listId: number;
    public typeId: number;
    constructor(io: ObjectStream, typeId?: number) {
   
        let count = io.readInt32();
        this.listId = io.readUInt32();
        this.typeId = typeId;
        // loop count () => TableListEntry
        this.entries = [];
        for(let i = 0; i < count; i++) {
            //tableType is used to lookup the object property/string table
            this.entries.push(this.readListEntry(io, this.listId));                
        }
    }
    public findElementByPath(elementPath: string): ListEntry {
        let path = elementPath.split(':'); 
        let element = this.entries.find(e => e.typeHash === murmurHash3Str(path[0]));
        path = path.splice(1);
        let fElement = element;
        let elements = [element];
        for(let p in path) {
            if(!element)
                break;
            let fullPath = path[p];
            let dictKey = null;
            // read out key from a path, ex: 'list[4]' has key = 4
            if(fullPath.endsWith(']')) {
                let keyStr = fullPath.match(/[^[\]]+(?=\])/g); 
                if(keyStr.length !== 1) {
                    throw new Error('Failed to parse key from path string');
                }
                dictKey = parseInt(keyStr[0], keyStr.includes('0x') ? 16: 10);
                fullPath = fullPath.split('[')[0];
            }
            // nagivate objects by hashed name
            const hash = murmurHash3Str(fullPath);
            let elements = element.findChildByName(fullPath, dictKey);  
            if(elements.length == 1) {
                element = elements[0];
            }
            else {
                throw new Error('Found too many matches from path ' + fullPath);
            }
        } 
    
        return  element;
    }
    public readListEntry(io: ObjectStream, type : number) : TableListEntry {
        const entry = new TableListEntry(io);
        entry.tableId = type;
        if(entry.hasChildren) {

            const headerSize = io.readInt32();
            const actualCount = io.readInt32();

            entry.headerSize = headerSize;
            entry.actualCount = actualCount;
            entry.headerCount = io.readUInt32();

            const valueType = entry.entryId.type;
            if(valueType <= ObjectType.WCString) {
                entry.setBuffer(io.readBytes(actualCount * headerSize));                
            }
            else {
                entry.children = [];
                switch(valueType) {   
                    case ObjectType.UnicodeString:  {
                        // Unicode string, size = character count, so totalLen = size * 2             
                        const strList = new StringListEntry();
                        for(let i = 0; i < actualCount; i++) {
                            io.alignTo(4);
                        
                            const size = io.readUInt32();
                            const string = io.readString("utf16le", size);
                            strList.children.push(string);
                            //setBuffer(Buffer.from(string));                              
                        }
                        entry.children.push(strList);
                        break;
                    }  
                    case ObjectType.Class: {
                        for(let i = 0; i < actualCount; i++) {                            
                            io.alignTo(4); 
                            const structEntry = new StructListEntry();
                            const count = io.readInt32();
                            const typeId = io.readUInt32();

                            structEntry.typeHash = typeId;
                            structEntry.children = [];
                            for(let x = 0; x < count; x++) {
                                structEntry.children.push(this.readListEntry(io, typeId));
                            }                         
                            entry.children.push(structEntry);
                        }
                        break;
                    }
                    default: {
                        throw new Error("type not supported for deserializing yet");
                    }
                }
            }
        }
        else {
            const valueType = entry.entryId.type;
            if(valueType <= ObjectType.WCString) {
                const size = io.readUInt32();
                if(size >= 4) {
                    io.alignTo(size);
                    if(size > 8) {
                        throw new Error("type not supported yet");
                    }
                }
                try {
                    entry.setBuffer(io.readBytes(size));
                }
                catch(e) {
                    console.log(e.toString());
                }
            }
            else {
                switch(valueType) {                  
                    case ObjectType.UnicodeString: {
                         // Unicode string, size = character count, so totalLen = size * 2
                        const size = io.readUInt32();
                        const string = io.readString("utf16le", size);
                        entry.setBuffer(Buffer.from(string));
                        break;
                    }
                    case ObjectType.Vector4: {
                         // float array 
                        const size = io.readUInt32();
                        io.alignTo(16);
                        entry.setBuffer(io.readBytes(size));
                        break;
                    }
                    case ObjectType.Class: { 
                        const count = io.readUInt32();
                        const typeId = io.readInt32();
                        if(count !== 0x0FEFEFEFE) {
                            entry.children = [];
                            for(let x = 0; x < count; x++) {
                                entry.children.push(this.readListEntry(io, typeId));
                            }
                            entry.arrayType = typeId;
                        }
                        else {
                            throw new Error("class type not supported for deserializing yet");
                        }
                        break;
                    }
                }
            }
        }
        return entry;
    }
    public serialize(io: ObjectStream): void {
        io.writeInt32(this.entries.length);
        io.writeUInt32(this.listId);
        this.entries.forEach(element => {
            element.serialize(io);
        });
    }
}
export interface Entry {
    children: any[];
    typeHash : number;

    insert(entry: any): void;
    findChildByName(name: string|number, key?:number): ListEntry[];
    serialize(io: ObjectStream): void;
    getBuffer(): Buffer;
    setBuffer(buffer: Buffer);
}
export interface ListEntry extends Entry {
    children : Entry[];
}
export interface StringEntry extends Entry {
    children : string[];
}
export class StructListEntry implements ListEntry {
    public typeHash : number;
    public children : TableListEntry[];

    static create(type: number): StructListEntry {
        const entry = new StructListEntry();
        entry.typeHash = type;
        entry.children = [];
        return entry;
    }
    public findChildByName(name: string, key?:number): TableListEntry[]  {
        let result = this.children.filter(c => c.name ? (c.name === name) : (c.typeHash === murmurHash3Str(name)));
        if(key != null && result.length > 1) {
            result = result.filter(r => {
                const keyProp =  r.findChildByName("Key")[0];
                const buffer = keyProp.getBuffer();
                if(buffer) {
                    return buffer.readInt32LE(0) === key;   
                }
                return false;
            });
        }
        return result;
    }
    public serialize(io: ObjectStream): void {
        throw new Error("not implemented");
    }
    public getBuffer(): Buffer {
        throw new Error("not implemented");
    }
    public setBuffer(buffer: Buffer) {
        throw new Error("not implemented");
    }
    public insert(entry: any) {
        throw new Error("not implemented");
    }    
}
class StringListEntry implements StringEntry {
    public children : string[];
    public typeHash : number;
    
    constructor() {
        this.children = [];
    }
    public findChildByName(name: string, key?:number): ListEntry[]  {
        throw new Error("not implemented");
    }
    public serializeToBuffer(): Buffer {
        const stream = new ObjectStream(new Buffer(8));
        this.serialize(stream);
        return stream.getBuffer();
    }
    public serialize(io: ObjectStream): void {
        for (let name in this.children) {
            io.alignTo(4);
            io.writeUInt32(name.length);
            io.writeString(name, "utf16le");
        }
    }
    public getBuffer(): Buffer {
        throw new Error("not implemented");
    }
    public setBuffer(buffer: Buffer) {
        throw new Error("not implemented");
    }
    public insert(entry: string) {
        if(!this.children){
            this.children = [];
        }
        this.children.push(entry);
    }    
}

export interface ListEntryId { // UINT64
    murmurHash : number; // 32 bits
    type : ObjectType; // 32 bits
}
export class TableListEntryId implements ListEntryId {
    public murmurHash : number; // 32 bits
    public type : ObjectType; // 32 bits
    public hasSubType: boolean;

    constructor(io: Stream, hashName?: number, type?: ObjectType) {
        if(io != null) {
            this.murmurHash = io.readUInt32();
            this.type = io.readInt32();
            if(this.type === -1) {          
                this.type = io.readInt32();
                this.hasSubType = true;
            }
        }
        else {
            this.murmurHash = hashName;
            this.type = type;
        }
    }

    public setId(hashName: number, type: ObjectType): void {
        this.murmurHash = hashName;
        this.type = type;
    }
    public serialize(io: ObjectStream): void {
        io.writeUInt32(this.murmurHash);
        if(this.hasSubType) {
            io.writeInt32(-1);
        }
        io.writeInt32(this.type);
    }
    public serializeToBuffer(): Buffer {
        const stream = new ObjectStream(new Buffer(8));
        this.serialize(stream);
        return stream.getBuffer();
    }

}
export class TableListEntry implements ListEntry {
    public children : Entry[];
    public entryId : TableListEntryId;
    public hasChildren : boolean;
    public name : string;
    public tableId : number;

    public headerSize: number;
    public actualCount: number;
    public headerCount: number;
    public buffer : Buffer;
    public arrayType: number;

    public get typeHash(): number {
        if(this.entryId) {
            return this.entryId.murmurHash;
        }
        return -1;
    }

    constructor(io?: ObjectStream) {
        if(io != null) {
            io.alignTo(4);
            const id = new TableListEntryId(io);
            this.hasChildren = id.hasSubType;

            // get property string name
            if(propertiesHashes.hasOwnProperty(id.murmurHash)) {
                this.name = propertiesHashes[id.murmurHash];
            }

            this.entryId = id;
        }
    }

    public static create(propertyName: string, propertyStruct: any): TableListEntry {
        const entry = new TableListEntry();
        const propHash = murmurHash3Str(propertyName);
        entry.entryId = new TableListEntryId(null, propHash, propertyStruct.objectType);
        if(propertyStruct.objectType == ObjectType.Class) {
            entry.children = [];
        }
        entry.setBuffer(this.serializeObject(propertyStruct.objectType, propertyStruct.data));

        return entry;
    }
    public static deserializeObject(type: ObjectType, data: Buffer): string|number|boolean {

        switch(type) {
            case ObjectType.Boolean: {
                return data.readInt8(0) === 1;
            }
            case ObjectType.Int32: {
                return data.readInt32LE(0);
            }
            case ObjectType.Uint32: {
                return data.readUInt32LE(0);
            }
            case ObjectType.Single: {
                return data.readFloatLE(0);
            }            
            case ObjectType.CString:
            case ObjectType.WCString:
            case ObjectType.UnicodeString: {
                return data.toString();
            }
            case ObjectType.Class:{ 
                // do nothing
                break;
            }
            default:
                throw new Error("type not yet supported");
            
        }
        return null;
    }
    public static serializeObject(type: ObjectType, data: number|boolean|string): Buffer {
        let buf = null;
        switch(type) {
            case ObjectType.Boolean: {
                buf = new Buffer(1);
                buf.writeUInt8(data, 0);
                break;
            }
            case ObjectType.Int32: {
                buf = new Buffer(4);
                buf.writeInt32LE(data, 0);
                break;
            }
            case ObjectType.Uint32: {
                buf = new Buffer(4);
                buf.writeUInt32LE(data, 0);
                break;
            }
            case ObjectType.Single: {
                let io = new Stream(new Buffer(4));
                io.writeFloat(data as number);
                buf = io.getBuffer();
                break;
            }            
            case ObjectType.CString:
            case ObjectType.WCString:
            case ObjectType.UnicodeString: {
                buf = Buffer.from(data as string);
                break;
            }
            case ObjectType.Class:{ 
                // do nothing
                break;
            }
            default:
                throw new Error("type not yet supported");
            
        }
        return buf;
    }

    public setBuffer(buffer : Buffer) {
        this.buffer = buffer;
    }

    public getBuffer(): Buffer {
        return this.buffer;
    }
    
    public insert(entry: any) {
        if(!this.children) {
            this.children = [];
        }
        this.children.push(entry);
        this.actualCount = this.children.length;
    }

    public findChildByName(name: string, key?:number): ListEntry[]  {
        let result = this.children.filter(c=>c.typeHash === murmurHash3Str(name));
        if(key != null && result.length > 1) {
            result = result.filter(r => {
                const res = r.findChildByName("Key", key);
                const keyProp =  res[0];
                const buffer = keyProp.getBuffer();
                if(buffer) {
                    return buffer.readInt32LE(0) === key;   
                }
                return false;
            });
        }
        return result;
    }

    public serialize(io: ObjectStream): void { 
        this.serializeList(this, io);
    }

    public serializeList(entry: TableListEntry, io: ObjectStream) {
        io.alignTo(4);
        entry.entryId.serialize(io);
        if(entry.hasChildren) {
            io.writeInt32(entry.headerSize);
            io.writeInt32(entry.actualCount);
            io.writeUInt32(entry.headerCount);
            if(entry.entryId.type <= ObjectType.WCString) {               
                io.writeBytes(entry.getBuffer());
            }
            else {
                switch(entry.entryId.type) {
                    case ObjectType.UnicodeString: { // unicode string
                        const stringList = <StringListEntry>entry.children[0];
                        stringList.children.forEach(element => {
                            io.alignTo(4);
                  
                            io.writeUInt32(element.length);             
                            io.writeString(element, "utf16le");
                        });
                        break;
                    }   
                    case ObjectType.Class: {
                        entry.children.forEach(element => {
                            io.alignTo(4);
                            const structElement = <StructListEntry>element;
                            io.writeInt32(structElement.children.length);
                            io.writeUInt32(structElement.typeHash);
                            structElement.children.forEach(strElement => {
                                this.serializeList(<TableListEntry>strElement, io);
                            });
                        });
                        break;
                    }
                    default: {
                        throw new Error("type not supported for serializing yet");
                    }                    
                }
            }
        }
        else {
            if(entry.entryId.type <= ObjectType.WCString) {
                const buffer = entry.getBuffer();
                io.writeUInt32(buffer.length);
                if(buffer.length >= 8) {
                    io.alignTo(8);
                }
                io.writeBytes(buffer);
            }
            else {
                switch(entry.entryId.type) {
                    case ObjectType.UnicodeString: { // unicode string
                        const data = entry.getBuffer().toString();
                        io.writeUInt32(data.length);
                        if(data.length > 0) {
                            io.writeString(data, "utf16le");
                        }
                        break;
                    }
                    case ObjectType.Vector4: {
                        const data = entry.getBuffer();
                        io.writeUInt32(data.length);
                        io.alignTo(16);
                        io.writeBytes(data);
                        break;
                    }
                    case ObjectType.Class: {
                        io.writeUInt32(entry.children.length);
                        io.writeUInt32(entry.arrayType);
                        if(entry.children.length > 0) {
                            entry.children.forEach(element => {
                                this.serializeList(<TableListEntry>element, io);
                            });
                        }
                        break;
                    }
                    default: {
                        throw new Error("type not supported for serializing yet");
                    }                    
                }
            }
        }
    }    
}
