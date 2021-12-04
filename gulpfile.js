const { src, dest, watch } = require('gulp');
const yargs = require('yargs'); // Yargs helps you build interactive command line tools, by parsing arguments and generating an elegant user interface. It gives: commands and (grouped) options. + a dynamically generated help menu based on your arguments. + bash-completion shortcuts for commands and options. + and tons more (https://github.com/yargs/yargs/blob/HEAD/docs/api.md).
const plugins = require('gulp-load-plugins'); // Loads gulp plugins from package dependencies and attaches them to an object of your choice.
const rimraf = require('rimraf'); // Deep delete like The UNIX command rm -rf for node.
const realFavicon = require('gulp-real-favicon'); // Generate a multiplatform favicon using RealFaviconGenerator (http://realfavicongenerator.net/).
const autoprefixer = require('autoprefixer'); // PostCSS plugin to parse CSS and add vendor prefixes to CSS rules using values from Can I Use.
const browser = require('browser-sync'); // Browsers are automatically updated as you change HTML, CSS, images and other project files (https://browsersync.io/).
const named = require('vinyl-named'); // Give vinyl files arbitrary chunk names.
const uncss = require('uncss'); // a tool that removes unused CSS from your stylesheets. It works across multiple files and supports Javascript-injected CSS.
const webpackStream = require('webpack-stream'); // Run webpack as a stream to conveniently integrate with gulp.
const webpack5212 = require('webpack'); // webpack@5.21.2
const path = require('path');
const fs = require('fs-extra'); // fs-extra adds file system methods that aren't included in the native fs module and adds promise support to the fs methods. It also uses graceful-fs to prevent EMFILE errors.

const util = require('./lib/util');
const builder = require('./lib/builder');
const sitemap = require('./lib/sitemap');

const config = require('./settings');

const PRODUCTION = config.PRODUCTION;
const $ = plugins({
	postRequireTransforms: {
		sass: (sass) => sass(require('sass')),
	},
});

const faviconConfig = config.FAVICON;
const webpackConfig = config.WEBPACK;

const fileTypes = util.fileTypes;
const PATHS = config.PATHS;
const UNCSS_OPTIONS = {
	html: config.UNCSS.html || `${PATHS.dist}/**/*.html`,
	ignore: config.UNCSS.ignore || [/^.is-.*/gi],
};
const COMPATIBILITY = config.COMPATIBILITY;

//TASK FUNCTIONS
function pages() {
	return gulp
		.src(`${PATHS.pages}/**/*.${fileTypes.page}`)
		.pipe(
			builder({
				root: PATHS.pages,
				layouts: PATHS.layouts,
				partials: PATHS.partials,
				data: PATHS.data,
				helpers: PATHS.helpers,
				isProduction: PRODUCTION,
				origin: config.ORIGIN,
				port: config.PORT,
				cdn: config.CDN,
			})
		)
		.pipe(
			$.if(
				config.INDEX.sitemap,
				sitemap({
					origin: config.ORIGIN,
					root: PATHS.pages,
					disallow: config.INDEX.disallow,
					robots: config.INDEX.robots,
				})
			)
		)
		.pipe(gulp.dest(PATHS.dist));
}

function clean(done) {
	rimraf(util.path(PATHS.dist), done);
}

function copyAssets() {
	return gulp
		.src([
			...util.getPlugins().reduce((a, c) => {
				a.push(`node_modules/${c}/src/assets/**/*`);
				a.push(`!node_modules/${c}/src/assets/{img,js,scss}/**/*`);
				return a;
			}, []),
			`${PATHS.assets}/**/*`,
			`!${PATHS.assets}/{img,js,scss}/**/*`,
		])
		.pipe(gulp.dest(PATHS.dist + '/assets'));
}

function copyPublic() {
	return gulp
		.src([
			...util
				.getPlugins()
				.map((p) => `node_modules/${p}/src/public/**/*`),
			`${PATHS.public}/**/*`,
		])
		.pipe(gulp.dest(PATHS.dist + '/'));
}

function copyContent() {
	return gulp
		.src([`${PATHS.data}/**/*.${fileTypes.content}`])
		.pipe(gulp.dest(PATHS.dist + '/files'));
}

function resetPages(done) {
	builder.refresh();
	done();
}

function sass() {
	const postCssPlugins = [
		autoprefixer({ overrideBrowserslist: COMPATIBILITY }),
		PRODUCTION &&
			config.UNCSS.enabled &&
			uncss.postcssPlugin(
				Object.assign(
					{},
					{
						banner: false,
						timeout: 0,
						inject: function (window) {
							window.document
								.querySelectorAll('script')
								.forEach((s) => s.remove());
						},
						jsdom: {
							features: {
								FetchExternalResources: [],
								ProcessExternalResources: [],
							},
							runScripts: 'no',
						},
					},
					UNCSS_OPTIONS
				)
			),
	].filter(Boolean);

	return gulp
		.src(
			PATHS.styles.map((entry) =>
				entry.slice(0, 5) === 'node_'
					? entry
					: `${PATHS.assets}${entry}`
			)
		)
		.pipe($.sourcemaps.init())
		.pipe(
			$.sass({
				includePaths: PATHS.sass,
			}).on('error', $.sass.logError)
		)
		.pipe($.postcss(postCssPlugins))
		.pipe($.if(PRODUCTION, $.cleanCss({ compatibility: 'ie9' })))
		.pipe($.if(!PRODUCTION, $.sourcemaps.write()))
		.pipe(gulp.dest(PATHS.dist + '/assets/css'))
		.pipe(browser.reload({ stream: true }));
}

function templates() {
	return gulp
		.src([
			...util
				.getPlugins()
				.map((p) => `node_modules/${p}/src/templates/**/*.html`),
			`${PATHS.templates}/**/*.html`,
		])
		.pipe(
			$.handlebars({
				handlebars: require('handlebars'),
			})
		)
		.pipe($.wrap(`template(<%= contents %>)`))
		.pipe(
			$.declare({
				//namespace: 'MyApp.templates',
				noRedeclare: true, // Avoid duplicate declarations
			})
		)
		.pipe($.concat('_tpl.js'))
		.pipe(
			$.if(
				PRODUCTION,
				$.uglify().on('error', (e) => {
					util.log(e);
				})
			)
		)
		.pipe(
			$.header(
				`\nvar template = Handlebars.template; Handlebars.templates = this;\n`
			)
		)
		.pipe(
			$.header(
				fs.readFileSync(
					'node_modules/handlebars/dist/handlebars.runtime.min.js',
					'utf8'
				)
			)
		)
		.pipe($.if(!PRODUCTION, $.sourcemaps.write()))
		.pipe(gulp.dest(PATHS.dist + '/assets/js'));
}

function javascript() {
	return gulp
		.src(PATHS.entries.map((entry) => `${PATHS.assets}${entry}`))
		.pipe(named())
		.pipe($.sourcemaps.init())
		.pipe(webpackStream(webpackConfig, webpack5212))
		.pipe(
			$.if(
				PRODUCTION,
				$.uglify().on('error', (e) => {
					util.log(e);
				})
			)
		)
		.pipe($.if(!PRODUCTION, $.sourcemaps.write()))
		.pipe(gulp.dest(PATHS.dist + '/assets/js'));
}

function images() {
	return gulp
		.src(`${PATHS.assets}/img/**/*`)
		.pipe(
			$.if(
				PRODUCTION,
				$.imagemin([$.imagemin.jpegtran({ progressive: true })])
			)
		)
		.pipe(gulp.dest(PATHS.dist + '/assets/img'));
}

function server(done) {
	browser.init(
		{
			server: PATHS.dist,
			port: config.PORT,
		},
		done
	);
}

// Reload the browser with BrowserSync
function reload(done) {
	browser.reload();
	done();
}

function watch() {
	gulp.watch(
		[`${PATHS.assets}/**/*`, `!${PATHS.assets}/{img,js,scss}/**/*`],
		copyAssets
	);
	gulp.watch(PATHS.public, copyPublic);
	gulp.watch(`${PATHS.pages}/**/*.${fileTypes.page}`).on(
		'all',
		gulp.series(pages, browser.reload)
	);
	gulp.watch([
		`${PATHS.layouts}/**/*.${fileTypes.partial}`,
		`${PATHS.partials}/**/*.${fileTypes.partial}`,
	]).on('all', gulp.series(resetPages, pages, browser.reload));
	gulp.watch(`${PATHS.templates}/**/*.html`).on(
		'all',
		gulp.series(templates, javascript, browser.reload)
	);
	gulp.watch(`src/data/**/*.${fileTypes.data}`).on(
		'all',
		gulp.series(resetPages, pages, browser.reload)
	);
	gulp.watch(`${PATHS.helpers}/**/*.js`).on(
		'all',
		gulp.series(resetPages, pages, browser.reload)
	);
	gulp.watch(`${PATHS.assets}/scss/**/*.scss`).on('all', sass);
	gulp.watch(`${PATHS.assets}/js/**/*.js`, { delay: 1000 }).on(
		'all',
		gulp.series(javascript, browser.reload)
	);
	gulp.watch(`${PATHS.assets}/img/**/*`).on(
		'all',
		gulp.series(images, browser.reload)
	);
}

function initTemplate(done) {
	fs.copy(util.local('template'), util.path('/'), done);
}

function create(done) {
	if (yargs.argv._[1] === undefined) {
		util.error('no target specified');
		return done();
	}
	let [category, target] = yargs.argv._[1].split(':');
	if (['layout', 'partial'].indexOf(category) === -1) {
		util.error('category can be only "layout" or "partial"');
		return done();
	}
	let sourcePath = util.local(`/lib/builder/${category}s/${target}.html`);
	let targetPath = util.path(`/src/${category}s/${target}.html`);
	if (!fs.existsSync(sourcePath)) {
		util.error('source file does not exists');
		return done();
	}
	if (fs.existsSync(targetPath)) {
		util.error('target file already exists');
		return done();
	}

	util.log(`create custom ${target} ${category}`);

	fs.copy(sourcePath, targetPath, done);
}

const favicon = function (done) {
	realFavicon.generateFavicon(
		Object.assign({}, faviconConfig, {
			masterPicture: util.path(PATHS.logo),
			dest: util.path(PATHS.public),
			markupFile: util.path(PATHS.faviconDataFile),
		}),
		function () {
			done();
		}
	);
};

const generate = require('./lib/generator')({
	sitemap: PATHS.sitemap,
	pages: PATHS.pages,
	partials: PATHS.partials,
});

const catalog = require('./lib/catalog')({
	data: PATHS.data,
	public: PATHS.public,
	origin: config.ORIGIN,
	siteName: config.SITE.name ? config.SITE.name : 'siteName',
	companyName: config.SITE.company ? config.SITE.company.name : 'companyName',
});

const copy = gulp.parallel(copyAssets, copyPublic, copyContent);

const build = gulp.series(
	clean,
	templates,
	gulp.parallel(pages, javascript, images, copy),
	sass
);

const init = gulp.series(initTemplate, generate);

//EXPORTS
module.exports = {
	copyAssets,
	copyPublic,
	templates,
	javascript,
	sass,
	pages,
	generate,
	favicon,
	catalog,
	build,
	init,
	create,
};
module.exports.default = gulp.series(build, server, watch);

/*
const browserify = require('browserify');
const babelify = require('babelify');
const source = require('vinyl-source-stream');
const buffer = require('vinyl-buffer');
*/
// const srcFiles = {
// 	jsPath: 'src/js/**/*.js',
// 	jsFiles: 'src/js/',
// };

// const sass = require('gulp-sass')(require('sass'));
// function scss() {
// 	return src('./src/scss/*.scss')
// 		.pipe(sass().on('error', sass.logError))
// 		.pipe(dest('./dist/assets/'));
// }
// exports.scss = scss;

// const rename = require('gulp-rename');
// const babel = require('gulp-babel');
// const concat = require('gulp-concat');
// const uglify = require('gulp-uglify');
// const gulpif = require('gulp-if');
// const replace = require('gulp-replace');
// function js() {
// 	return src('./src/js/**/*.js')
// 		.pipe(gulpif(!production, sourcemaps.init({ loadMaps: true }))) //To load existing source maps, This will cause sourceMaps to use the previous sourcemap to create an ultimate sourcemap
// 		.pipe(
// 			gulpif(
// 				production,
// 				babel({
// 					presets: ['@babel/preset-env'],
// 				})
// 			)
// 		)
// 		.pipe(concat('all.js'))
// 		.pipe(gulpif(production, rename({ extname: '.min.js' })))
// 		.pipe(gulpif(production, uglify()))
// 		.pipe(gulpif(!production, sourcemaps.write('./')))
// 		.pipe(dest('./dist/js/'));
// }
/*
exports.js = js;

async function jsTask() {
	jsFiles.map(function (entry) {
		return (
			browserify({
				entries: [jsFolder + entry],
			})
				.transform(babelify, { presets: ['@babel/preset-env'] })
				.bundle()
				.pipe(source('all.js'))
				// To load existing source maps
				// This will cause sourceMaps to use the previous sourcemap to create an ultimate sourcemap
				.pipe(gulpif(production, rename({ extname: '.min.js' })))
				.pipe(buffer())
				.pipe(gulpif(!production, sourcemaps.init({ loadMaps: true })))
				// .pipe(concat('all.js'))
				.pipe(gulpif(production, uglify()))
				.pipe(gulpif(!production, sourcemaps.write('./')))
				.pipe(dest(distFiles.distJSPath))
		);
	});
}

function fonts() {
	return src('./src/fonts/*.*').pipe(dest('./dist/fonts/'));
}
exports.fonts = fonts;

const imagemin = require('gulp-imagemin');
const responsive = require('gulp-responsive'); /* Seo we can use:
<picture>
    <source srcset="./public/perlin-200px.png" media="(max-width: 200px">
    <source srcset="./public/perlin-500px.png" media="(max-width: 500px">
    <source srcset="./public/perlin-800px.png" media="(max-width: 800px">
    <img class="img-loading" src="./public/perlin.png" alt="Flowing line art">
</picture>
*/
// function images() {
// 	return src('./src/images/*.*')
// 		.pipe(
// 			responsive({
// 				'*.png': [
// 					{
// 						width: 200,
// 						rename: { suffix: '-200px' },
// 					},
// 					{
// 						width: 500,
// 						rename: { suffix: '-500px' },
// 					},
// 					{
// 						width: 800,
// 						rename: { suffix: '-800px' },
// 					},
// 				],
// 			})
// 		)
// 		.pipe(
// 			imagemin([
// 				imagemin.mozjpeg({ quality: 75, progressive: true }),
// 				imagemin.optipng({ optimizationLevel: 5 }),
// 			])
// 		)
// 		.pipe(dest('./dist/images/'));
// }
// exports.images = images;

// exports.watch = function () {
// 	watch('./src/scss/*.scss', scss);
// 	watch('./src/js/*.js', js);
// 	watch('./src/fonts/*.*', fonts);
// 	watch('./src/images/*.*', images);
// };

/************HTML includes with Gulp.js************* */
/*
const gulp = require('gulp');
const fileinclude = require('gulp-file-include');
const server = require('browser-sync').create();
const { watch, series } = require('gulp');

const paths = {
	scripts: {
		src: './',
		dest: './build/',
	},
};

// Reload Server
async function reload() {
	server.reload();
}
*/
// Copy assets after build
// async function copyAssets() {
// 	gulp.src(['assets/**/*']).pipe(gulp.dest(paths.scripts.dest));
// }
/*
// Build files html and reload server
async function buildAndReload() {
	await includeHTML();
	await copyAssets();
	reload();
}

async function includeHTML() {
	return gulp
		.src([
			'*.html',
			'!header.html', // ignore
			'!footer.html', // ignore
		])
		.pipe(
			fileinclude({
				prefix: '@@',
				basepath: '@file',
			})
		)
		.pipe(gulp.dest(paths.scripts.dest));
}
exports.includeHTML = includeHTML;
*/
// exports.default = async function () {
// 	// Init serve files from the build folder
// 	server.init({
// 		server: {
// 			baseDir: paths.scripts.dest,
// 		},
// 	});
// 	// Build and reload at the first time
// 	buildAndReload();
// 	// Watch task
// 	watch(['*.html', 'assets/**/*'], series(buildAndReload));
// };
