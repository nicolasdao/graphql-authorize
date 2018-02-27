/**
 * Copyright (c) 2018, Neap Pty Ltd.
 * All rights reserved.
 * 
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree.
*/

const fs = require('fs')
const path = require('path')
const { getQueryAST, buildQuery } = require('graphql-s2s').graphqls2s

/*eslint-disable */
const cwdPath = f => path.join(process.cwd(), f)
/*eslint-enable */
const CONFIGPATH = cwdPath('now.json')
const getAppConfig = () => fs.existsSync(CONFIGPATH) ? require(CONFIGPATH) : {}
const PARAMS_PROP_NAME = (getAppConfig().params || {}).propName || 'params'

const setError = (res, err, code=500) => 
	res.status(code).send({ errors: [{ message: `${err.message}${err.stack ? `\n${err.stack}` : ''}`, locations: err.locations, path: err.path }] })

const createGraphQlWarning = (paths=[]) => paths.length == 0 ? null : [{
	message: 'Access denied for certain fields. The current response is incomplete.',
	path: paths.map(p => p.property)
}]

/**
 * Returns Express-like middleware 
 * 
 * @param  {Object} 	schemaAST               			schemaAST acquired thank to method graphqls2s.getSchemaAST
 * @param  {Fcuntion} 	options.authenticationFields 		Function that accepts a single AST object and determine what makes 
 *                                                   		a field restricted or not.
 * @param  {Function} 	options.authorizationFields 		Function that accepts 2 objects: AST and an authenticated user. Only called when 
 *                                                  		user is successfully authenticated
 * @param  {Boolean} 	options.partialAccess 				Defines whether or not the request fails completely if the user is not authenticated 
 *                                             				or if he is still allowed to access the fields he is authorized to access.
 * @param  {Boolean} 	options.nullifyUnauthorizedFields 	Defines whether or not the request fails completely if the user is not authenticated 
 *                                             			    or if he is still allowed to access the fields he is authorized to access.
 */
const graphqlAuthenticate = (schemaAST, authenticate, options={}) => {
	if (!authenticate || typeof(authenticate) != 'function')
		throw new Error('Wrong argument exception. The \'authenticate\' argument in function \'graphqlAuthenticate\' is required and must be a function.')
	if (!schemaAST)
		throw new Error('Wrong argument exception. The \'schemaAST\' argument in function \'graphqlAuthenticate\' is required and must be an object.')

	const authenticationFields = options.authenticationFields && typeof(options.authenticationFields) == 'function' 
		? options.authenticationFields
		: null
	const authorizationFields = options.authorizationFields && typeof(options.authorizationFields) == 'function' 
		? options.authorizationFields
		: null
	const partialAccess = options.partialAccess != undefined 
		? options.partialAccess 
		: true
	const nullifyUnauthFields = options.nullifyUnauthorizedFields != undefined 
		? options.nullifyUnauthorizedFields 
		: false

	const authenticateRequest = (req, res) => new Promise((onSuccess, onFailure) => {
		try {
			authenticate(req, res, (err, user) => onSuccess({err, user}))
		}
		catch(err) {
			onFailure(err)
		}
	})

	const authenticateGraphQlRequest = (req, res, reqParams, pathsWithRestriction=[], requestAST) => authenticateRequest(req, res).then(
		({err, user}) => {
			// 1. STRICT ACCESS - If there is no partial access, the user must be authenticated to access anything.
			if (!partialAccess && (err || !user))
				setError(res, { message: 'Access denied.' }, 403)
			// 2. PARTIAL ACCESS - If partial access is on, then the user might still be able to access some parts of the API.
			else {
				let query, limitedAccessAST, warnings, accessCompletelyDenied, transform
				// 2.1. No parts of the request require any auth. The entire request can be executed. That happens
				// either when:
				// 	- 'authenticationFields' has not been specified
				// 	- 'authenticationFields' has been specified, but the request does not contain any fields requiring auth. 
				if (pathsWithRestriction.length == 0) {
					limitedAccessAST = requestAST
					query = reqParams.query
				}
				// 2.2. Some parts of the API require some filtering based the user's auth and what's defined in
				// either 'authorizationFields' or 'authenticationFields' is 'authorizationFields' is not defined ('authenticationFields'
				// is guaranteed to exist, otherwise 'pathsWithRestriction.length' would had been equal to 0). 
				else {
					// 2.2.1. If the user has been authenticated, based on his state, he may or may not have access to 
					// some part of the API. If the 'authorizationFields' has been defined, then use it, otherwise, fall back on
					// 'authenticationFields' ('authenticationFields' must exist, otherwise we would not have reached this part of  
					// the code. We would have entered #1).
					if (user) {
						if (authorizationFields) {
							// 2.2.1.1. For all fields that required auth, check if the current user has the right privileges.
							const restrictedPaths = requestAST.propertyPaths(a => authenticationFields(a) && !authorizationFields(a, user)) || []
							// 2.2.1.2. If there are some fields the currently authenticated user can't access because he does not
							// have the appropriate privileges, then...
							if (restrictedPaths.length > 0) {
								limitedAccessAST = requestAST.filter(a => !authenticationFields(a) || authorizationFields(a, user))
								warnings = createGraphQlWarning(restrictedPaths)
								if (nullifyUnauthFields)
									transform = nullifyUnauthorizedFields(restrictedPaths)
								accessCompletelyDenied = !partialAccess
								if (accessCompletelyDenied)
									setError(res, { message: 'Access denied.' }, 403)
							}
							// 2.2.1.3. Otherwise, the user has full access to the current query, so no need to filter anything.
							else
								limitedAccessAST = requestAST
						}
						else
							limitedAccessAST = requestAST

						query = buildQuery(limitedAccessAST)
					}
					// 2.2.2. If the user hasn't been authenticated or if there is no 'authorizationFields' defined, then simply 
					// fall back on removing all the fields defined by the 'authenticationFields' rule.
					else {
						limitedAccessAST = requestAST.filter(a => !authenticationFields(a))
						query = buildQuery(limitedAccessAST)
						warnings = createGraphQlWarning(pathsWithRestriction)
						if (nullifyUnauthFields)
							transform = nullifyUnauthorizedFields(pathsWithRestriction)
					}
				}

				if (!accessCompletelyDenied) {
					// 3. If there are still some fields left.
					if (limitedAccessAST.properties && limitedAccessAST.properties.length > 0) {
						req.graphql = {
							query: query,
							variables: reqParams.variables,
							operationName: reqParams.operationName
						}
						if (warnings)
							req.graphql.warnings = warnings
						if (transform) {
							req.graphql.transform = transform
						}
					}
					// 4. If the result of the lack of access is an empty query, then deny access completely.
					else {
						req.graphql = {
							query: 'query{}',
							errors: [{
								message: 'Access denied.',
								path: pathsWithRestriction
							}]
						}
					}
				}
			}
		})

	return (req, res, next) => Promise.resolve(null)
		.then(() => {
			try {
				const reqParams = req[PARAMS_PROP_NAME]
				if (reqParams.query) {
					const requestAST = getQueryAST(reqParams.query, reqParams.operationName, schemaAST, { defrag: true }) || []
					const pathsWithRestriction = authenticationFields ? requestAST.propertyPaths(authenticationFields) : []

					const todo = pathsWithRestriction.length > 0
						? authenticateGraphQlRequest(req, res, reqParams, pathsWithRestriction, requestAST)
						: authenticateRequest(req, res)

					return todo.catch(err => setError(res, err))
				}
			}
			catch(err) {
				setError(res, err)
			}
		})
		.then(() => next())
}

const nullifyUnauthorizedFields = (paths=[]) => result => {
	if (!paths.length || !result || !result.data)
		return result 

	paths.forEach(p => {
		const prop = p.property 
		prop.split('.').reduce((a,propName) => {
			const typeA = typeof(a)
			if (a == null || typeA == 'number' || typeA == 'string' || typeA == 'boolean')
				return null

			const pName = propName.split(':')[0] 
			if (Array.isArray(a)) {
				let allNull = true
				const acc = []
				a.forEach(x => {
					const v = x[pName]
					if (v == undefined) 
						x[pName] = null
					else {
						allNull = false
						Array.isArray(v) ? acc.push(...v) : acc.push(v)
					}
				})
				return allNull ? null : acc
			}
			else {
				const v = a[pName]
				if (v == undefined) {
					a[pName] = null
					return null
				}
				else
					return v
			}
		}, result.data)
	})

	return result
}

module.exports = graphqlAuthenticate




