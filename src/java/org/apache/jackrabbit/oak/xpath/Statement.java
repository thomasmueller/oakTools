/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.apache.jackrabbit.oak.xpath;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

import org.apache.jackrabbit.oak.xpath.QueryOptions.Traversal;

/**
 * An xpath statement.
 */
public class Statement {
    
    boolean explain;
    boolean measure;
    
    /**
     * The selector to get the columns from (the selector used in the select
     * column list).
     */
    private Selector columnSelector;
    
    private ArrayList<Expression> columnList = new ArrayList<Expression>();
    
    /**
     * All selectors.
     */
    private ArrayList<Selector> selectors;
    
    private Expression where;

    ArrayList<Order> orderList = new ArrayList<Order>();
    
    String xpathQuery;
    
    QueryOptions queryOptions;
  
    
    @Override
    public String toString() {
        StringBuilder buff = new StringBuilder();
        
        // explain | measure ...
        if (explain) {
            buff.append("explain ");
        } 
        if (measure) {
            buff.append("measure ");
        }
        
        // select ...
        buff.append("select ");
        buff.append(new Expression.Property(columnSelector, QueryConstants.JCR_PATH, false).toString());
        if (selectors.size() > 1) {
            buff.append(" as ").append('[').append(QueryConstants.JCR_PATH).append(']');
        }
        buff.append(", ");
        buff.append(new Expression.Property(columnSelector, QueryConstants.JCR_SCORE, false).toString());
        if (selectors.size() > 1) {
            buff.append(" as ").append('[').append(QueryConstants.JCR_SCORE).append(']');
        }
        if (columnList.isEmpty()) {
            buff.append(", ");
            buff.append(new Expression.Property(columnSelector, "*", false).toString());
        } else {
            for (int i = 0; i < columnList.size(); i++) {
                buff.append(", ");
                Expression e = columnList.get(i);
                String columnName = e.toString();
                buff.append(columnName);
                if (selectors.size() > 1) {
                    buff.append(" as [").append(e.getColumnAliasName()).append("]");
                }
            }
        }
        
        // from ...
        buff.append(" from ");
        for (int i = 0; i < selectors.size(); i++) {
            Selector s = selectors.get(i);
            if (i > 0) {
                buff.append(" inner join ");
            }
            String nodeType = s.nodeType;
            if (nodeType == null) {
                nodeType = "nt:base";
            }
            buff.append('[' + nodeType + ']').append(" as ").append(s.name);
            if (s.joinCondition != null) {
                buff.append(" on ").append(s.joinCondition);
            }
        }
        
        // where ...
        if (where != null) {
            buff.append(" where ").append(where.toString());
        }
        
        // order by ...
        if (!orderList.isEmpty()) {
            buff.append(" order by ");
            for (int i = 0; i < orderList.size(); i++) {
                if (i > 0) {
                    buff.append(", ");
                }
                buff.append(orderList.get(i));
            }
        }
        appendQueryOptions(buff, queryOptions);
        // leave original xpath string as a comment
        appendXPathAsComment(buff, xpathQuery);
        return buff.toString();        
    }


    public void setExplain(boolean explain) {
        this.explain = explain;
    }

    public void setMeasure(boolean measure) {
        this.measure = measure;
    }

    public void addSelectColumn(Expression.Property p) {
        columnList.add(p);
    }

    public void setSelectors(ArrayList<Selector> selectors) {
        this.selectors = selectors;
    }
    
    public void setWhere(Expression where) {
        this.where = where;
    }

    public void addOrderBy(Order order) {
        this.orderList.add(order);
    }

    public void setColumnSelector(Selector columnSelector) {
        this.columnSelector = columnSelector;
    }
    
    public void setOriginalQuery(String xpathQuery) {
        this.xpathQuery = xpathQuery;
    }
    
    /**
     * A union statement.
     */
    static class UnionStatement extends Statement {
        
        private final Statement s1, s2;
        
        UnionStatement(Statement s1, Statement s2) {
            this.s1 = s1;
            this.s2 = s2;
        }
        
        @Override
        public String toString() {
            StringBuilder buff = new StringBuilder();
            // explain | measure ...
            if (explain) {
                buff.append("explain ");
            } 
            if (measure) {
                buff.append("measure ");
            }
            buff.append(s1).append(" union ").append(s2);
            // order by ...
            if (orderList != null && !orderList.isEmpty()) {
                buff.append(" order by ");
                for (int i = 0; i < orderList.size(); i++) {
                    if (i > 0) {
                        buff.append(", ");
                    }
                    buff.append(orderList.get(i));
                }
            }
            appendQueryOptions(buff, queryOptions);
            // leave original xpath string as a comment
            appendXPathAsComment(buff, xpathQuery);
            return buff.toString();
        }
        
    }
    
    private static void appendQueryOptions(StringBuilder buff, QueryOptions queryOptions) {
        if (queryOptions == null) {
            return;
        }
        buff.append(" option(");
        List<String> optionValues = new ArrayList<>();
        if (queryOptions.traversal != Traversal.DEFAULT) {
            optionValues.add("traversal " + queryOptions.traversal);
        }
        if (queryOptions.indexName != null) {
            optionValues.add("index name [" + queryOptions.indexName + "]");
        }
        if (queryOptions.indexTag != null) {
            optionValues.add("index tag [" + queryOptions.indexTag + "]");
        }
        if (queryOptions.offset.isPresent()) {
            optionValues.add("offset " + queryOptions.offset.get());
        }
        if (queryOptions.limit.isPresent()) {
            optionValues.add("limit " + queryOptions.limit.get());
        }
        if (queryOptions.prefetchCount.isPresent()) {
            optionValues.add("prefetches " + queryOptions.prefetchCount.get());
        }
        if (!queryOptions.prefetch.isEmpty()) {
            String list = queryOptions.prefetch.stream()
                    .map(SQL2Parser::escapeStringLiteral)
                    .collect(Collectors.joining(", "));
            optionValues.add("prefetch (" + list + ")");
        }
        buff.append(String.join(", ", optionValues));
        buff.append(")");
    }
    
    private static void appendXPathAsComment(StringBuilder buff, String xpath) {
        if (xpath == null) {
            return;
        }
    }

    public  void setQueryOptions(QueryOptions options) {
        this.queryOptions = options;
    }

}
