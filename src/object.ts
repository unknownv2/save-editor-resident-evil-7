import { Stream } from 'libvantage';


export enum ObjectType {
    Unknown = 0x00,

    Enum = 0x01,

    Boolean = 0x02,

    Int8 = 0x03,

    Uint8 = 0x04,

    Int16 = 0x05,

    Uint16 = 0x06,

    Int32 = 0x07, 

    Uint32 = 0x08,

    Int64 = 0x09,

    UInt64 = 0x0A,

    Single = 0x0B,

    Double = 0x0C,

    CString = 0x0D,

    WCString = 0x0E,

    UnicodeString = 0x0F,

    Vector4 = 0x10,

    Class = 0x11,
}


export class ObjectStream extends Stream {

    public alignTo(alignmentWidth: number): void {
        let align = (this.position % alignmentWidth);
        if(align > 0) {
            const newPosition = (this.position + (alignmentWidth - align));
            if(this.length < (this.position + (alignmentWidth - align))) {
                this.writeBytes(new Buffer(alignmentWidth - align)); // fill with zeroes
            }
            else {
                this.position += (alignmentWidth - align);
            }
        }
    }  
}