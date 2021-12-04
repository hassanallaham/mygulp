const yaml = require('js-yaml');
const path = require('path');
const fs = require('fs-extra');
const fm = require('front-matter'); // Extract meta data (front-matter) from documents.
const stripBom = require('strip-bom'); // Strip UTF-8 byte order mark (BOM) from a string. (The Unicode Standard permits the BOM in UTF-8, but does not require nor recommend its use. Byte order has no meaning in UTF-8.)
const extend = require('deepmerge'); // Merges the enumerable properties of two or more objects deeply.

class DataFile {
	constructor(filePath) {
		this.path = path.resolve(filePath);
		this.type = path.extname(this.path).substr(1);
		this.content = null;
	}

	isSupported() {
		return ['yml', 'yaml', 'json', 'html'].indexOf(this.type) !== -1;
	}

	async read(noCache = false) {
		if (this.content && !noCache) {
			return this.content;
		}

		if (await fs.pathExists(this.path)) {
			switch (this.type) {
				case 'yml':
				case 'yaml':
					this.content = yaml.load(
						await fs.readFile(this.path, 'utf8')
					);
					break;
				case 'html':
					this.content = fm(
						stripBom(await fs.readFile(this.path, 'utf8'))
					);
					break;
				case 'json':
					this.content = require(this.path);
					break;
				default:
					throw new Error(`File type ${this.type} not supported`);
			}
		} else {
			this.content = {};
		}

		return this.content;
	}

	patch(data) {
		this.content = extend(this.content, data);
	}

	async write(data) {
		if (!this.content) await this.read();
		if (data) this.patch(data);

		let fileContent = '';
		switch (this.type) {
			case 'yml':
			case 'yaml':
				fileContent = yaml.dump(this.content);
				break;
			case 'json':
				fileContent = JSON.stringify(this.content, null, '  ');
				break;
			case 'html':
				fileContent = [
					'---',
					yaml.dump(this.content.attributes),
					'---',
					this.content.body,
				].join('\n');
				break;
			default:
				throw new Error(`File type ${this.type} not supported`);
		}

		return fs.writeFile(this.path, fileContent);
	}
}

module.exports = DataFile;
