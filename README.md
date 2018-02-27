# graphql-authorize &middot;  [![NPM](https://img.shields.io/npm/v/graphql-authorize.svg?style=flat)](https://www.npmjs.com/package/graphql-authorize) [![License](https://img.shields.io/badge/License-BSD%203--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause) [![Neap](https://neap.co/img/made_by_neap.svg)](#this-is-what-we-re-up-to)
Authorization middleware for [_graphql-serverless_](https://github.com/nicolasdao/graphql-serverless). Add inline authorization straight into the GraphQl schema to restrict access to certain fields based on the user's rights. __*graphql-serverless*__ allows to deploy [GraphQL](http://graphql.org/learn/) apis (including an optional [GraphiQL interface](https://github.com/graphql/graphiql)) to the most popular serverless platforms:
- [Zeit Now](https://zeit.co/now) (using express under the hood)
- [Google Cloud Functions](https://cloud.google.com/functions/) (incl. Firebase Function)
- [AWS Lambdas](https://aws.amazon.com/lambda)
- [Azure Functions](https://azure.microsoft.com/en-us/services/functions/) (COMING SOON...)

Decorate your fields with something similar to this in your GraphQl schema:
```js
type Product {
  id: ID!
  @auth
  name: String!
  shortDescription: String
}
```

Then define a rule similar to this one:
```js
{
  authenticationFields: field => field.metadata && field.metadata.name == 'auth'
}
```

If the user is not authenticated (more about this below), then a GraphQl query similar to this:
```js
{
  products(id:2) {
    id
    name
  }
}
```

will return an HTTP response with status 200 similar to this:
```js
{
  "data": {
    "products": [
      {
        "id": "2"
      }
    ]
  },
  "warnings": [
    {
      "message": "Access denied for certain fields. The current response is incomplete.",
      "path": [
        "products.name"
      ]
    }
  ]
}
```

> TIP - It is also possible to configure the middleware to nullify the `name` field rather than omitting it (refer to section [Returning `null` Rather Than Removing Fields](#returning-null-rather-than-removing-fields)). This is usually rather important client libraries using caching like the [apollo-client](https://github.com/apollographql/apollo-client) which would break otherwise.

# Table Of Contents
> * [Install](#install)
> * [How To Use It](#how-to-use-it)
> 	- [Basics](#basics)
> 	- [Managing Authorizations](#managing-authorizations)
>	- [Returning `null` Rather Than Removing Fields](#returning-null-rather-than-removing-fields)
>	- [Not Returning Partial Response](#not-returning-partial-response)

# Install
### node
```js
npm install graphql-authorize --save
```

# How To Use It
## Basics
An example will worth a thousand words. Follow those steps:
1. Create a new npm project: `npm init`
2. Install the following packages: `npm install graphql-s2s graphql-serverless graphql-authorize webfunc lodash --save` 
3. Create a new `index.js` as follow:

	```js
	const graphqlAuth = require('graphql-authorize')
	const { getSchemaAST, transpileSchema } = require('graphql-s2s').graphqls2s
	const { graphqlHandler } = require('graphql-serverless')
	const { app } = require('webfunc')
	const { makeExecutableSchema } = require('graphql-tools')
	const _ = require('lodash')

	// STEP 1. Mock some data for this demo.
	const productMocks = [
		{ id: 1, name: 'Product A', shortDescription: 'First product.', owner: 'Marc Stratfield' }, 
		{ id: 2, name: 'Product B', shortDescription: 'Second product.', owner: 'Nic Dao' }]

	const variantMocks = [
		{ id: 1, name: 'Variant A', shortDescription: 'First variant.' }, 
		{ id: 2, name: 'Variant B', shortDescription: 'Second variant.' }]

	// STEP 2. Creating a basic GraphQl Schema augmented with some non-standard authorizaion metadata
	//         thanks to the 'graphql-s2s' package (https://github.com/nicolasdao/graphql-s2s). 
	const schema = `
	type Product {
		id: ID!
		@auth
		name: String!
		shortDescription: String
		owner: String
	}
	type Variant {
		id: ID!
		name: String!
		shortDescription: String
	}
	type Query {
		products(id: Int): [Product]
		variants(id: Int): [Variant]
	}
	`

	const productResolver = {
		Query: {
			products(root, { id }, context) {
				const results = id ? productMocks.filter(p => p.id == id) : productMocks
				if (results.length > 0)
					return results
				else
					throw new Error(`Product with id ${id} does not exist.`)
			}
		}
	}

	const variantResolver = {
		Query: {
			variants(root, { id }, context) {
				const results = id ? variantMocks.filter(p => p.id == id) : variantMocks
				if (results.length > 0)
					return results
				else
					throw new Error(`Variant with id ${id} does not exist.`)
			}
		}
	}

	// STEP 3. Transpiling our schema on steroid to a standard schema using the 'transpileSchema'
	//         function from the 'graphql-s2s' package (https://github.com/nicolasdao/graphql-s2s). 
	const executableSchema = makeExecutableSchema({
		typeDefs: transpileSchema(schema),
		resolvers: _.merge(productResolver, variantResolver) 
	})

	// STEP 4. Creating the Express-like middleware that will define the authorization rules that will give
	//         access or not to certain fields.
	const schemaAST = getSchemaAST(schema)
	const authorize = graphqlAuth(
		// AST of the Graphql schema augmented with metadata
		schemaAST, 
		// Function that must terminate by a call to the 'next' callback with 2 required arguments:
		// @param  {Object} err   Potential error object useful for identifying the source of the 
		//                        authentication failure.
		// @param  {Object} user  If this object exists, then the authentication based on data contained 
		//                        in the 'req' object is successfull, otherwise it is not.
		(req, res, next) => {
			// This example below simulates a situation where all request will always be
			// unauthenticated.
			const err = null
			const user = null
			next(err, user)
		}, 
		// Defines the authentication rules, i.e. the rule on each field that determines
		// whether that field requires authentication.
		{
			authenticationFields: field => field.metadata && field.metadata.name.indexOf('auth') == 0
		})

	// STEP 5. Creating a GraphQL and a GraphiQl endpoint
	const graphqlOptions = {
		schema: executableSchema,
		graphiql: {
			endpoint: '/graphiql'
		}
	}

	app.all(['/', '/graphiql'], authorize, graphqlHandler(graphqlOptions))

	// STEP 5. Starting the server 
	app.listen(4000)
	```

4. Run `node index.js`
5. Browse to [`http://localhost:4000/graphiql`](http://localhost:4000/graphiql)
6. Execute a query similar to this in graphiql:
	```js
	{
	  products(id:2) {
	    id
	      name
	  }
	}
	```

	Because we've hardcoded that all requests are unauthenticated (ref. STEP 4. `user = null`), this request above will yield the following result HTTP 200 response:

	```js
	{
	  "data": {
	    "products": [
	      {
	        "id": "2"
	      }
	    ]
	  },
	  "warnings": [
	    {
	      "message": "Access denied for certain fields. The current response is incomplete.",
	      "path": [
	        "products.name"
	      ]
	    }
	  ]
	}
	```

> NOTICE that you're not forced to use the metadata `@auth` to defined what field is restricted to authenticated user. You can do what ever you want. We just thought it made sense based on our own experience.

> TIP - It is also possible to configure the middleware to nullify the `name` field rather than omitting it (refer to section [Returning `null` Rather Than Removing Fields](#returning-null-rather-than-removing-fields)). This is usually rather important client libraries using caching like the [apollo-client](https://github.com/apollographql/apollo-client) which would break otherwise.

## Managing Authorizations

In the previous example, we introduced how to restrict access to unauthenticated users. Now we'll see how we can restrict access based on roles of authenticated users. 

In STEP 2, updates the schema as follow:
```js
type Product {
  id: ID!
  @auth
  name: String!
  shortDescription: String
  @auth(admin)
  owner: String
}
```

In STEP 4, update the code as follow:
```js
const authorize = graphqlAuth(
  schemaAST, 
  (req, res, next) => {
    const err = null
    const user = { role: 'standard' }
    next(err, user)
  }, 
  {
    authenticationFields: field => field.metadata && field.metadata.name.indexOf('auth') == 0,
    authorizationFields: (field, user) => 
       field.metadata && 
       ((field.metadata.name == 'auth' && !field.metadata.body) || field.metadata.name == 'auth' && field.metadata.body == `(${user.role})`)
  })
```

The code above restricts the access to the `Product.owner` field to user with an `admin` role. For the sake of this demo, all requests are now being hardcoded so that the user is authenticated (i.e. the `user` object exists) and its role is `standard`. 

The following request:
```js
{
  products(id:2) {
    id
    name
    owner
  }
}
```

will now return:
```js
{
  "data": {
    "products": [
      {
        "id": "2",
        "name": "Product B"
      }
    ]
  },
  "warnings": [
    {
      "message": "Access denied for certain fields. The current response is incomplete.",
      "path": [
        "products.owner"
      ]
    }
  ]
}
```

As you can see, now that the request is authenticated, the `name` field is accessible, but because the user's role is `standard` rather tha admin, the `owner` property is not accessible.

Update the role above to `admin` and see what happens.

## Returning `null` Rather Than Removing Fields

The previous examples have demonstrated fields not being returned when the request is either not authenticated or lacking the adequate rights. However, this behavior might break some client libraries like the [apollo-client](https://github.com/apollographql/apollo-client) which expect the schema of the response to conform to the request schema. To allow support for such use cases, it is possible to nullify fields rather than removing them, thanks to the `nullifyUnauthorizedFields` property:

```js
const authorize = graphqlAuth(
  schemaAST, 
  (req, res, next) => {
    const err = null
    const user = { role: 'standard' }
    next(err, user)
  }, 
  {
    authenticationFields: field => field.metadata && field.metadata.name.indexOf('auth') == 0,
    authorizationFields: (field, user) => 
       field.metadata && 
       ((field.metadata.name == 'auth' && !field.metadata.body) || field.metadata.name == 'auth' && field.metadata.body == `(${user.role})`),
       nullifyUnauthorizedFields: true
  })
```

## Not Returning Partial Response

So far, all previous examples have demonstrated partial response being returned in case of missing authentication or missing rights. However, one other desired behavior could to fail completely with an HTTP 403 forbidden. This can be done using the `partialAccess` property.

```js
const authorize = graphqlAuth(
  schemaAST, 
  (req, res, next) => {
    const err = null
    const user = { role: 'standard' }
    next(err, user)
  }, 
  {
    authenticationFields: field => field.metadata && field.metadata.name.indexOf('auth') == 0,
    authorizationFields: (field, user) => 
       field.metadata && 
       ((field.metadata.name == 'auth' && !field.metadata.body) || field.metadata.name == 'auth' && field.metadata.body == `(${user.role})`),
       nullifyUnauthorizedFields: true,
       partialAccess: false
  })
```


# This Is What We re Up To
We are Neap, an Australian Technology consultancy powering the startup ecosystem in Sydney. We simply love building Tech and also meeting new people, so don't hesitate to connect with us at [https://neap.co](https://neap.co).

Our other open-sourced projects:
#### Web Framework & Deployment Tools
* [__*webfunc*__](https://github.com/nicolasdao/webfunc): Write code for serverless similar to Express once, deploy everywhere. 
* [__*now-flow*__](https://github.com/nicolasdao/now-flow): Automate your Zeit Now Deployments.

#### GraphQL
* [__*graphql-serverless*__](https://github.com/nicolasdao/graphql-serverless): GraphQL (incl. a GraphiQL interface) middleware for [webfunc](https://github.com/nicolasdao/webfunc).
* [__*schemaglue*__](https://github.com/nicolasdao/schemaglue): Naturally breaks down your monolithic graphql schema into bits and pieces and then glue them back together.
* [__*graphql-s2s*__](https://github.com/nicolasdao/graphql-s2s): Add GraphQL Schema support for type inheritance, generic typing, metadata decoration. Transpile the enriched GraphQL string schema into the standard string schema understood by graphql.js and the Apollo server client.
* [__*graphql-authorize*__](https://github.com/nicolasdao/graphql-authorize.git): Authorization middleware for [graphql-serverless](https://github.com/nicolasdao/graphql-serverless). Add inline authorization straight into your GraphQl schema to restrict access to certain fields based on your user's rights.

#### React & React Native
* [__*react-native-game-engine*__](https://github.com/bberak/react-native-game-engine): A lightweight game engine for react native.
* [__*react-native-game-engine-handbook*__](https://github.com/bberak/react-native-game-engine-handbook): A React Native app showcasing some examples using react-native-game-engine.

#### Tools
* [__*aws-cloudwatch-logger*__](https://github.com/nicolasdao/aws-cloudwatch-logger): Promise based logger for AWS CloudWatch LogStream.


# License
Copyright (c) 2018, Neap Pty Ltd.
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name of Neap Pty Ltd nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL NEAP PTY LTD BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

<p align="center"><a href="https://neap.co" target="_blank"><img src="https://neap.co/img/neap_color_horizontal.png" alt="Neap Pty Ltd logo" title="Neap" height="89" width="200"/></a></p>
