const { create, ConverterType } = require("@alexanderolsen/libsamplerate-js");
const { Transform } = require("stream");

class Resample48to16 extends Transform {
    constructor() {
        super();
        this._ready = create(1, 48000, 16000, {
            converterType: ConverterType.SRC_SINC_BEST_QUALITY,
        }).then((src) => (this._src = src));

        this._buffer = Buffer.alloc(0);
        this._inBytes = 960 * 2;
    }

    async resampleFrame(frameBuffer) {
        // as before:
        const inSamples = new Int16Array(
            frameBuffer.buffer,
            frameBuffer.byteOffset,
            frameBuffer.length / 2
        );
        const floatOut = this._src.simple(inSamples);
        const outSamples = Int16Array.from(floatOut, (v) =>
            Math.max(-32768, Math.min(32767, Math.round(v * 32768)))
        );
        return Buffer.from(outSamples.buffer);
    }

    async _transform(chunk, _, callback) {
        await this._ready;
        this._buffer = Buffer.concat([this._buffer, chunk]);

        while (this._buffer.length >= this._inBytes) {
            const frame = this._buffer.subarray(0, this._inBytes);
            this._buffer = this._buffer.subarray(this._inBytes);

            const outBuf = await this.resampleFrame(frame);
            this.push(outBuf);
        }

        callback();
    }

    _flush(callback) {
        callback();
    }
}

module.exports = Resample48to16;
